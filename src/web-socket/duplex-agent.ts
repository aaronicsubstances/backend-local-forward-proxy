import io from "socket.io-client";
import ss from "socket.io-stream";
import type { 
    FailureNotification, 
    PendingTransfer, 
    PendingTransferAction,
    PendingTransferKey, 
    PollRequest, 
    ResponseHeadersNotification 
} from "../types";

import * as api from "../api";
import * as logger from "../logger";
import { Readable } from "stream";

export class DuplexAgent {
    #targetAppId: string
    #reverseProxyBaseUrl: string
    #targetAppBaseUrl: string
    #requestTimeoutMillis?: number
    #client: any
    #stopped = false

    constructor(targetAppId: string,
            reverseProxyBaseUrl: string, targetAppBaseUrl: string,
            requestTimeoutMillis?: number) {
        if (typeof targetAppId !== "string") {
            throw new Error("targetAppId must be a string. Received: " + targetAppId);
        }
        
        // ensure no trailing slashes in urls
        if (reverseProxyBaseUrl.endsWith("/")) {
            reverseProxyBaseUrl = reverseProxyBaseUrl.substring(0,
                reverseProxyBaseUrl.length - 1);
        }
        if (targetAppBaseUrl.endsWith("/")) {
            targetAppBaseUrl = targetAppBaseUrl.substring(0,
                targetAppBaseUrl.length - 1);
        }

        this.#targetAppId = targetAppId;
        this.#reverseProxyBaseUrl = reverseProxyBaseUrl;
        this.#targetAppBaseUrl = targetAppBaseUrl;
        this.#requestTimeoutMillis = requestTimeoutMillis;
    }

    stop() {
        this.#stopped = true;
        if (this.#client) {
            this.#client.disconnect();
        }
    }

    start() {
        if (this.#stopped) {
            return;
        }

        const client = io(this.#reverseProxyBaseUrl, { transports: ["websocket"] });
        this.#client = client;
        const pendingTransfers = new Map<string, PendingTransfer>();
        client.on("connect", () => {
            logger.warn("[%s] connected", this.#targetAppId);
            // start looking for requests.
            pendingTransfers.clear();
            const pollReq: PollRequest = { backendId: this.#targetAppId };
            client.emit("req-h", pollReq);
        });
        client.on("disconnect", (reason) => {
            logger.warn("[%s] disconnected due to %s", this.#targetAppId, reason);
        });
        client.on("req-h", (res: PendingTransfer) => {
            if (res.id) {
                this.#logDebug(res, `pending request found for target ${this.#targetAppId} with id ${res.id}`);
                pendingTransfers.set(res.id, res);

                // fetch corresponding response body
                const transferKey: PendingTransferKey = { backendId: this.#targetAppId, id: res.id }
                client.emit("req-b", transferKey);
            }
            else {
                logger.debug(`no pending request found for target ${this.#targetAppId}`);
            }

            // in any case try again looking for requests.
            const pollReq: PollRequest = { backendId: this.#targetAppId };
            client.emit("req-h", pollReq);
        });
        ss(client).on('req-b', (stream: Readable, res: PendingTransferKey) => {
            const pendingTransfer = pendingTransfers.get(res.id);
            if (!pendingTransfer) {
                logger.error(`Transfer id ${res.id} not found`);
                return;
            }
            
            this.#logDebug(pendingTransfer, `Fetch of request body from remote proxy successful`);

            api.forwardRequest(this.#targetAppBaseUrl, pendingTransfer, stream, this.#requestTimeoutMillis,
                (error, targetUrlRes) => {
                    const targetUrl = `${this.#targetAppBaseUrl}${pendingTransfer.path}`;
                    if (targetUrlRes) {
                        this.#logInfo(pendingTransfer, `target ${this.#targetAppId} - Request to ` +
                            `${targetUrl} has returned ${targetUrlRes.status} ${targetUrlRes.statusText}.`);

                        pendingTransfer.resBody = targetUrlRes.body;
                        
                        const responseMetadata: ResponseHeadersNotification = {
                            backendId: this.#targetAppId,
                            id: pendingTransfer.id,
                            statusCode: targetUrlRes.status,
                            statusMessage: targetUrlRes.statusText,
                            headers: targetUrlRes.headers.raw()
                        };
                        client.emit("res-h", responseMetadata);
                    }
                    else {
                        // request to target API failed.
                        pendingTransfers.delete(res.id);

                        if (!error) {
                            return;
                        }

                        const failureReason: FailureNotification = {
                            backendId: this.#targetAppId,
                            id: pendingTransfer.id
                        };
                        if (error.name === "AbortError") {
                            this.#logError(pendingTransfer, `target ${this.#targetAppId} - Request to ` +
                                `${targetUrl} timed out`);
                            failureReason.remoteTimeout = true;
                        }
                        else if (error.name === 'FetchError') {
                            this.#logError(pendingTransfer, `target ${this.#targetAppId} - Could not make request to ` +
                                `${targetUrl} ${error.message}`);
                            failureReason.error = error.message;
                        }
                        else {
                            this.#logError(pendingTransfer, `target ${this.#targetAppId} - Request to ` +
                                `${targetUrl} encountered error ${error}`);
                            failureReason.error = "internal error occured at local forward proxy";
                        }

                        // notify remote proxy to fail fast on this request.
                        client.emit("transfer-err", failureReason);
                    }
                });
        });
        client.on("res-h", (res: PendingTransferAction) => {
            const pendingTransfer = pendingTransfers.get(res.id);
            if (!pendingTransfer) {
                logger.error(`Transfer id ${res.id} not found`);
                return;
            }
            if (!res.error) {
                this.#logDebug(pendingTransfer, `response headers successfully sent to remote proxy`);

                const stream = ss.createStream();
                const transferKey: PendingTransferKey = { backendId: this.#targetAppId, id: res.id };
                ss(client).emit('res-b', stream, transferKey);
                if (pendingTransfer.resBody) {
                    pendingTransfer.resBody.pipe(stream);
                }
                else {
                    pendingTransfers.delete(res.id);
                    this.#logError(pendingTransfer, `could not find response body to send to remote proxy`);
                }
            }
            else {
                pendingTransfers.delete(res.id);
                this.#logError(pendingTransfer, 'transfer of response headers to remote proxy unsuccesful ' +
                    res.error);
            }
        });
        client.on('res-b', (res: PendingTransferAction) => {
            const pendingTransfer = pendingTransfers.get(res.id);
            if (!pendingTransfer) {
                logger.error(`Transfer id ${res.id} not found`);
                return;
            }
            pendingTransfers.delete(res.id);
            if (!res.error) {
                this.#logInfo(pendingTransfer, `response completely sent to remote proxy`);
            }
            else {
                // final response body transfer to remote proxy failed.
                this.#logError(pendingTransfer, `transfer of response body to remote proxy encountered error ` +
                    res.error);
            }
        });
        client.on("transfer-err", (res: PendingTransferAction) => {
            if (res.backendId !== this.#targetAppId) {
                return;
            };
            const pendingTransfer = pendingTransfers.get(res.id);
            if (pendingTransfer) {
                pendingTransfers.delete(res.id);
                this.#logWarn(pendingTransfer, "remote proxy failed transfer due to " + res.error);
            }
        });
    }

    #logDebug(pendingTransfer: PendingTransfer, msg: string) {
        logger.debug("%s. %s %s%s - %s", pendingTransfer.id, pendingTransfer.method,
            this.#targetAppId, pendingTransfer.path, msg);
    }

    #logInfo(pendingTransfer: PendingTransfer, msg: string) {
        logger.info("%s. %s %s%s - %s", pendingTransfer.id, pendingTransfer.method,
            this.#targetAppId, pendingTransfer.path, msg);
    }

    #logWarn(pendingTransfer: PendingTransfer, msg: string) {
        logger.warn("%s. %s %s%s - %s", pendingTransfer.id, pendingTransfer.method,
            this.#targetAppId, pendingTransfer.path, msg);
    }

    #logError(pendingTransfer: PendingTransfer, msg: string) {
        logger.error("%s. %s %s%s - %s", pendingTransfer.id, pendingTransfer.method,
            this.#targetAppId, pendingTransfer.path, msg);
    }
}