const io = require("socket.io-client");
const ss = require('socket.io-stream');

const api = require("../api");
const logger = require("../logger");

class DuplexAgent {
    constructor(targetAppId, reverseProxyBaseUrl, targetAppBaseUrl) {
        this.targetAppId = targetAppId;
        this.reverseProxyBaseUrl = reverseProxyBaseUrl;
        this.targetAppBaseUrl = targetAppBaseUrl;
    }

    start() {
        const client = io(this.reverseProxyBaseUrl, { transports: ["websocket"] });
        let pendingTransfers = new Map();
        client.on("connect", () => {
            logger.warn(`[${this.targetAppId}]`, "connected");
            // start looking for requests.
            pendingTransfers.clear();
            client.emit("req-h", { backendId: this.targetAppId });
        });
        client.on("disconnect", (reason) => {
            logger.warn(`[${this.targetAppId}]`, "disconnected due to", reason);
        });
        client.on("req-h", res => {
            if (res.id) {
                this._log('debug', res, `pending request found for target ${this.targetAppId} with id ${res.id}`);
                pendingTransfers.set(res.id, res);

                // fetch corresponding response body
                client.emit("req-b", { backendId: this.targetAppId, id: res.id });
            }
            else {
                logger.debug(`no pending request found for target ${this.targetAppId}`);
            }

            // in any case try again looking for requests.
            client.emit("req-h", { backendId: this.targetAppId });
        });
        ss(client).on('req-b', (stream, res) => {
            if (!pendingTransfers.has(res.id)) {
                logger.error(`Transfer id ${res.id} not found`);
                return;
            }
            
            const pendingTransfer = pendingTransfers.get(res.id);
            this._log('debug', pendingTransfer, `Fetch of request body from remote proxy successful`);

            api.forwardRequest(this.targetAppBaseUrl, pendingTransfer, stream,
                (error, targetUrlRes) => {
                    const targetUrl = `${this.targetAppBaseUrl}${pendingTransfer.path}`;
                    if (targetUrlRes) {
                        this._log('info', pendingTransfer, `target ${this.targetAppId} - Request to ` +
                            `${targetUrl} has returned ${targetUrlRes.status} ${targetUrlRes.statusText}.`);

                        pendingTransfer.resBody = targetUrlRes.body;
                        
                        const responseMetadata = {
                            backendId: this.targetAppId,
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

                        const failureReason = {
                            backendId: this.targetAppId,
                            id: pendingTransfer.id
                        };
                        if (error.name === "AbortError") {
                            this._log('error', pendingTransfer, `target ${this.targetAppId} - Request to ` +
                                `${targetUrl} timed out`);
                            failureReason.remoteTimeout = true;
                        }
                        else if (error.name === 'FetchError') {
                            this._log('error', pendingTransfer, `target ${this.targetAppId} - Could not make request to ` +
                                `${targetUrl}`, error.message);
                            failureReason.error = error.message;
                        }
                        else {
                            this._log('error', pendingTransfer, `target ${this.targetAppId} - Request to ` +
                                `${targetUrl} encountered error`, error);
                            failureReason.error = "internal error occured at local forward proxy";
                        }

                        // notify remote proxy to fail fast on this request.
                        client.emit("transfer-err", failureReason);
                    }
                });
        });
        client.on("res-h", (res) => {
            if (!pendingTransfers.has(res.id)) {
                logger.error(`Transfer id ${res.id} not found`);
                return;
            }
            const pendingTransfer = pendingTransfers.get(res.id);
            if (!res.error) {
                this._log('debug', pendingTransfer, `response headers successfully sent to remote proxy`);

                const stream = ss.createStream();
                ss(client).emit('res-b', stream, { backendId: this.targetAppId, id: res.id });
                pendingTransfer.resBody.pipe(stream);
            }
            else {
                pendingTransfers.delete(res.id);
                this._log('error', pendingTransfer, 'transfer of response headers to remote proxy unsuccesful', res.error);
            }
        });
        client.on('res-b', (res) => {
            if (!pendingTransfers.has(res.id)) {
                logger.error(`Transfer id ${res.id} not found`);
                return;
            }
            const pendingTransfer = pendingTransfers.get(res.id);
            pendingTransfers.delete(res.id);
            if (!res.error) {
                this._log('info', pendingTransfer, `response completely sent to remote proxy`);
            }
            else {
                // final response body transfer to remote proxy failed.
                this._log('error', pendingTransfer, `transfer of response body to remote proxy encountered error`, res.error);
            }
        });
        client.on("transfer-err", res => {
            if (res.backendId !== this.targetAppId || !pendingTransfers.has(res.id)) {
                return;
            };
            const pendingTransfer = pendingTransfers.get(res.id);
            pendingTransfers.delete(res.id);
            this._log("warn", pendingTransfer, "remote proxy failed transfer due to", res.error);
        });
    }

    _log(level, pendingTransfer, msg, extra) {
        logger[level](`${pendingTransfer.id}. ${pendingTransfer.method}`,
            `${this.targetAppId}${pendingTransfer.path} -`, msg, extra || '');
    }
}

module.exports = {
    DuplexAgent
};