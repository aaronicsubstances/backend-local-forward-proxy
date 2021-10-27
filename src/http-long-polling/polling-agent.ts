import fetch from "node-fetch";

import * as logger from "../logger";
import { PendingTransfer } from "../types";
import * as utils from "../utils";
import { WorkerDelegate } from "./worker-delegate";

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
                    new WorkerDelegate(this.#targetAppId,
                        this.#reverseProxyBaseUrl, this.#targetAppBaseUrl, res, this.#requestTimeoutMillis).start();
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
}

module.exports = {
    PollingAgent
};