import fetch from "node-fetch";
import { Readable } from "stream";

import * as api from "../api";
import * as logger from "../logger";
import {
    FailureNotification,
    PendingTransfer,
    ResponseHeadersNotification } from "../types";
import * as utils from "../utils";

export class WorkerDelegate {
    #targetAppId: string;
    #reverseProxyBaseUrl: string;
    #targetAppBaseUrl: string;
    #requestMetadata: PendingTransfer
    #requestTimeoutMillis?: number

    constructor(targetAppId: string, 
            reverseProxyBaseUrl: string,
            targetAppBaseUrl: string,
            requestMetadata: PendingTransfer,
            requestTimeoutMillis?: number) {
        this.#targetAppId = targetAppId;
        this.#reverseProxyBaseUrl = reverseProxyBaseUrl;
        this.#targetAppBaseUrl = targetAppBaseUrl;
        this.#requestMetadata = requestMetadata;
        this.#requestTimeoutMillis = requestTimeoutMillis;
        this.#logInfo(`received for processing`);
    }

    start() {
        const fetchRequestBodyUrl = `${this.#reverseProxyBaseUrl}/req-b/${this.#targetAppId}/${this.#requestMetadata.id}`;
        fetch(fetchRequestBodyUrl)
            .then(utils.checkFetchResponseStatus)
            .then((reqBodyFetchRes: Readable) => {
                this.#logDebug(`Fetch of request body from remote proxy successful`);

                api.forwardRequest(this.#targetAppBaseUrl, this.#requestMetadata, reqBodyFetchRes, this.#requestTimeoutMillis,
                    (error, targetUrlRes) => {
                        const targetUrl = `${this.#targetAppBaseUrl}${this.#requestMetadata.path}`;
                        if (targetUrlRes) {                            
                            this.#logInfo(`target ${this.#targetAppId} - Request to ` +
                                `${targetUrl} has returned ${targetUrlRes.status} ${targetUrlRes.statusText}.`);
                            this.#transferResponse(targetUrlRes);
                        }
                        else {
                            if (!error) {
                                return;
                            }

                            // request to target API failed.
                            const failureReason: Omit<FailureNotification, "backendId" | "id"> = {
                            };
                            if (error.name === "AbortError") {
                                this.#logError(`target ${this.#targetAppId} - Request to ` +
                                    `${targetUrl} timed out`);
                                failureReason.remoteTimeout = true;
                            }
                            else if (error.name === 'FetchError') {
                                this.#logError(`target ${this.#targetAppId} - Could not make request to ` +
                                    `${targetUrl} ${error.message}`);
                                failureReason.error = error.message;
                            }
                            else {
                                this.#logError(`target ${this.#targetAppId} - Request to ` +
                                    `${targetUrl} encountered error ${error}`);
                                failureReason.error = "internal error occured at local forward proxy";
                            }

                            // notify remote proxy to fail fast on this request. ignore any errors.
                            const failFastUrl = `${this.#reverseProxyBaseUrl}/err/${this.#targetAppId}/${this.#requestMetadata.id}`;
                            fetch(failFastUrl, {
                                method: "POST",
                                body: JSON.stringify(failureReason),
                                headers: { 'Content-Type': 'application/json' },                        
                            }).catch(() => {});
                        }
                    });
            })
            .catch((error: Error) => {
                // fetching of request body from remote proxy failed.
                this.#logError(`Fetch of request body from remote proxy unsuccessful ${error}r`);
            });
    }

    #transferResponse(res: any) {
        const transferResponseMetadataUrl = `${this.#reverseProxyBaseUrl}/res-h/${this.#targetAppId}`;
        const responseMetadata: Omit<ResponseHeadersNotification, "backendId"> = {
            id: this.#requestMetadata.id,
            statusCode: res.status as number,
            statusMessage: res.statusText as string,
            headers: res.headers.raw() as Record<string, string[]>
        };
        fetch(transferResponseMetadataUrl, {
            method: "POST",
            body:    JSON.stringify(responseMetadata),
            headers: { 'Content-Type': 'application/json' },
        })
        .then(utils.checkFetchResponseStatus)
        .then(() => {
            this.#logDebug(`response headers successfully sent to remote proxy`);
            const transferResponseBodyUrl = `${this.#reverseProxyBaseUrl}/res-b/${this.#targetAppId}/${this.#requestMetadata.id}`;
            fetch(transferResponseBodyUrl, {
                method: "POST",
                body: res.body,
                // very important to set content type as binary so that body parsers
                // in remote proxy can leave it alone.
                headers: { 'Content-Type': 'application/octet-stream' }
            })
            .then(utils.checkFetchResponseStatus)
            .then(() => {
                this.#logInfo(`response completely sent to remote proxy`);
            })
            .catch((error: Error) => {
                // final response body transfer to remote proxy failed.
                this.#logError(`transfer of response body to remote proxy encountered error ${error}`);
            })
        })
        .catch((error: Error) => {
            this.#logError(`transfer of response headers to remote proxy unsuccesful ${error}`);
        });
    }

    #logDebug(msg: string) {
        logger.debug("%s. %s %s%s - %s", this.#requestMetadata.id, this.#requestMetadata.method,
            this.#targetAppId, this.#requestMetadata.path, msg);
    }

    #logInfo(msg: string) {
        logger.info("%s. %s %s%s - %s", this.#requestMetadata.id, this.#requestMetadata.method,
            this.#targetAppId, this.#requestMetadata.path, msg);
    }

    #logWarn(msg: string) {
        logger.warn("%s. %s %s%s - %s", this.#requestMetadata.id, this.#requestMetadata.method,
            this.#targetAppId, this.#requestMetadata.path, msg);
    }

    #logError(msg: string) {
        logger.error("%s. %s %s%s - %s", this.#requestMetadata.id, this.#requestMetadata.method,
            this.#targetAppId, this.#requestMetadata.path, msg);
    }
}