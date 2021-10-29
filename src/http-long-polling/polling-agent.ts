import fetch from "node-fetch";
import { Readable } from "stream";

import * as api from "../api";
import * as logger from "../logger";
import {
    FailureNotification,
    PendingTransfer,
    PendingTransferKey,
    ResponseHeadersNotification
} from "../types";
import * as utils from "../utils";

export class PollingAgent {
    #targetAppId: string
    #reverseProxyBaseUrl: string
    #targetAppBaseUrl: string
    #connectionCount = 1
    #failureCount = 0
    #stopped = false
    #maxTargetConnectionCount: number
    #requestTimeoutMillis?: number

    constructor(targetAppId: string, 
            reverseProxyBaseUrl: string, targetAppBaseUrl: string,
            maxTargetConnectionCount?: number, requestTimeoutMillis?: number) {
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
        this.#maxTargetConnectionCount = maxTargetConnectionCount || 5;
        this.#requestTimeoutMillis = requestTimeoutMillis;
    }

    stop() {
        this.#stopped = true;
    }

    start() {
        if (this.#stopped) {

        }
        else {
            this.#nextRun();
        }
    }

    #nextRun() {
        if (this.#stopped) {
            return;
        }

        /*
        idea is that as long as we find work to do, increase number of connections to remote proxy.
        else maintain just one connection.

        do this repeatedly till program exits:
        
            fire multiple connections determined by current/last success count.
            wait for them,
            analyze: did all succeed? 
            if yes, reset failure count, increase success count for next iteration, capped by max count, and 
            try firing multiple connections again with new number and with no reconnection interval.

            if failure. reset success cnt, and increment failure count.
            calculate reconnection interval. and fire single connection
            unless it didn't find work. in which case reset both success and failure cnt
            and fire single connection with no reconnection interval
        */
        this.#createNextRoundOfMultipleConnections()
            .then(result => {
                if (result.allConnectionsPickedUpWork) {
                    this.#failureCount = 0;
                    // increment connectionCount, but cap by configured maximum.
                    this.#connectionCount = Math.max(1, Math.min(this.#connectionCount + 1,
                        this.#maxTargetConnectionCount));
                    this.#nextRun();
                }
                else {
                    this.#connectionCount = 1; // reset.
                    if (result.someFailed) {
                        this.#failureCount++;
            
                        // delay for some time before reconnecting.
                        setTimeout(() => this.#nextRun(), 
                            utils.calculateReconnectInterval(this.#failureCount));
                    }
                    else {
                        this.#failureCount = 0;
                        this.#nextRun();
                    }
                }
            });
    }

    #createNextRoundOfMultipleConnections(): Promise<{allConnectionsPickedUpWork: boolean, someFailed: boolean}> {
        return new Promise((resolutionFunc, rejectionFunc) => {
            let interimSuccessCount = 0, interimFailureCount = 0, returnCount = 0;
            for (let i = 0; i < this.#connectionCount; i++) {
                this.#connectToRemoteProxy()
                    .then(result => {
                        returnCount++;
                        if (result.foundWorkToDo) {
                            interimSuccessCount++;
                        }
                        if (result.failed) {
                            interimFailureCount++;
                        }
                        if (returnCount === this.#connectionCount) {
                            resolutionFunc({
                                allConnectionsPickedUpWork: interimSuccessCount === this.#connectionCount, 
                                someFailed: interimFailureCount > 0
                            });
                        }
                    });
            }
        });
    }

    #connectToRemoteProxy(): Promise<{ failed?: boolean, foundWorkToDo?: boolean }> {
        const fetchUrl = `${this.#reverseProxyBaseUrl}/req-h/${this.#targetAppId}`;
        return fetch(fetchUrl)
            .then(utils.checkFetchResponseStatus)
            .then((res: any) => res.json())
            .then((res: PendingTransfer) => {
                if (res.id) {
                    logger.debug(`pending request found for target ${this.#targetAppId} with id ${res.id}`);
                    this.#startTransferWork(res);
                    return {
                        f: false,
                        foundWorkToDo: true
                    };
                }
                else {
                    // no work found.
                    logger.debug(`no pending request found for target ${this.#targetAppId}`);
                    return {
                        // neither succeeded nor failed.
                    };
                }
            })
            .catch((err: Error) => {
                if (err.name === 'FetchError') {
                    logger.warn(`Unsuccessful fetch for target ${this.#targetAppId}:`, err.message);
                }
                else {
                    logger.error(`An error occured during fetch for target ${this.#targetAppId}`, err);
                }
                return {
                    failed: true,
                };
            });
    }

    #startTransferWork(pendingTransfer: PendingTransfer) {
        const fetchRequestBodyUrl = `${this.#reverseProxyBaseUrl}/req-b`;
        fetch(fetchRequestBodyUrl, {
            method: "POST",
            body: JSON.stringify({
                backendId: this.#targetAppId,
                id: pendingTransfer.id
            } as PendingTransferKey),
            headers: { 'Content-Type': 'application/json' }
        })
            .then(utils.checkFetchResponseStatus)
            .then((reqBodyFetchRes: Readable) => {
                this.#logDebug(pendingTransfer, `Fetch of request body from remote proxy successful`);

                api.forwardRequest(this.#targetAppBaseUrl, pendingTransfer, reqBodyFetchRes, this.#requestTimeoutMillis,
                    (error, targetUrlRes) => {
                        const targetUrl = `${this.#targetAppBaseUrl}${pendingTransfer.path}`;
                        if (targetUrlRes) {                            
                            this.#logInfo(pendingTransfer, `target ${this.#targetAppId} - Request to ` +
                                `${targetUrl} has returned ${targetUrlRes.status} ${targetUrlRes.statusText}.`);
                            this.#transferResponse(pendingTransfer, targetUrlRes);
                        }
                        else {
                            if (!error) {
                                return;
                            }

                            // request to target API failed.
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

                            // notify remote proxy to fail fast on this request. ignore any errors.
                            const failFastUrl = `${this.#reverseProxyBaseUrl}/transfer-err`;
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
                this.#logError(pendingTransfer, `Fetch of request body from remote proxy unsuccessful ${error}r`);
            });
    }

    #transferResponse(pendingTransfer: PendingTransfer, res: any) {
        const transferResponseMetadataUrl = `${this.#reverseProxyBaseUrl}/res-h`;
        const responseMetadata: ResponseHeadersNotification = {
            id: pendingTransfer.id,
            backendId: this.#targetAppId,
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
            this.#logDebug(pendingTransfer, `response headers successfully sent to remote proxy`);
            const transferResponseBodyUrl = `${this.#reverseProxyBaseUrl}/res-b/${this.#targetAppId}/${pendingTransfer.id}`;
            fetch(transferResponseBodyUrl, {
                method: "POST",
                body: res.body,
                // very important to set content type as binary so that body parsers
                // in remote proxy can leave it alone.
                headers: { 'Content-Type': 'application/octet-stream' }
            })
            .then(utils.checkFetchResponseStatus)
            .then(() => {
                this.#logInfo(pendingTransfer, `response completely sent to remote proxy`);
            })
            .catch((error: Error) => {
                // final response body transfer to remote proxy failed.
                this.#logError(pendingTransfer, `transfer of response body to remote proxy encountered error ${error}`);
            })
        })
        .catch((error: Error) => {
            this.#logError(pendingTransfer, `transfer of response headers to remote proxy unsuccesful ${error}`);
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

module.exports = {
    PollingAgent
};