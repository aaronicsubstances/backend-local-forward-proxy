const fetch = require("node-fetch");

const api = require("../api");
const logger = require("../logger");
const utils = require("../utils");

class WorkerDelegate {
    constructor(targetAppId, reverseProxyBaseUrl, targetAppBaseUrl, requestMetadata) {
        this.targetAppId = targetAppId;
        this.reverseProxyBaseUrl = reverseProxyBaseUrl;
        this.targetAppBaseUrl = targetAppBaseUrl;
        this.requestMetadata = requestMetadata;
        this._log('info', `received for processing`);
    }

    start() {
        const fetchRequestBodyUrl = `${this.reverseProxyBaseUrl}/req-b/${this.targetAppId}/${this.requestMetadata.id}`;
        fetch(fetchRequestBodyUrl)
            .then(utils.checkFetchResponseStatus)
            .then(reqBodyFetchRes => {
                this._log('debug', `Fetch of request body from remote proxy successful`);

                const targetUrl = `${this.targetAppBaseUrl}${this.requestMetadata.path}`;
                const method = this.requestMetadata.method;
                const headers = utils.convertHeadersFromNativeToFetchFormat(this.requestMetadata.headers);

                api.forwardRequest(targetUrl, method, headers, reqBodyFetchRes,
                    (error, targetUrlRes) => {
                        if (targetUrlRes) {                            
                            this._log('info', `target ${this.targetAppId} - Request to ` +
                                `${targetUrl} has returned ${targetUrlRes.status} ${targetUrlRes.statusText}.`);
                            this._transferResponse(targetUrlRes);
                        }
                        else {
                            // request to target API failed.
                            const failureReason = {};
                            if (error.name === "AbortError") {
                                this._log('error', `target ${this.targetAppId} - Request to ` +
                                    `${targetUrl} timed out`);
                                failureReason.remoteTimeout = true;
                            }
                            else if (error.name === 'FetchError') {
                                this._log('error', `target ${this.targetAppId} - Could not make request to ` +
                                    `${targetUrl}`, error.message);
                                failureReason.error = error.message;
                            }
                            else {
                                this._log('error', `target ${this.targetAppId} - Request to ` +
                                    `${targetUrl} encountered error`, error);
                                failureReason.error = "internal error occured at local forward proxy";
                            }

                            // notify remote proxy to fail fast on this request. ignore any errors.
                            const failFastUrl = `${this.reverseProxyBaseUrl}/err/${this.targetAppId}/${this.requestMetadata.id}`;
                            fetch(failFastUrl, {
                                method: "POST",
                                body: JSON.stringify(failureReason),
                                headers: { 'Content-Type': 'application/json' },                        
                            }).catch(() => {});
                        }
                    });
            })
            .catch(error => {
                // fetching of request body from remote proxy failed.
                this._log('error', `Fetch of request body from remote proxy unsuccessful`, error);
            });
    }

    _transferResponse(res) {
        const transferResponseMetadataUrl = `${this.reverseProxyBaseUrl}/res-h/${this.targetAppId}`;
        const responseMetadata = {
            id: this.requestMetadata.id,
            statusCode: res.status,
            statusMessage: res.statusText,
            headers: res.headers.raw()
        };
        fetch(transferResponseMetadataUrl, {
            method: "POST",
            body:    JSON.stringify(responseMetadata),
            headers: { 'Content-Type': 'application/json' },
        })
        .then(utils.checkFetchResponseStatus)
        .then(() => {
            this._log('debug', `response headers successfully sent to remote proxy`);
            const transferResponseBodyUrl = `${this.reverseProxyBaseUrl}/res-b/${this.targetAppId}/${this.requestMetadata.id}`;
            fetch(transferResponseBodyUrl, {
                method: "POST",
                body: res.body,
                // very important to set content type as binary so that body parsers
                // in remote proxy can leave it alone.
                headers: { 'Content-Type': 'application/octet-stream' }
            })
            .then(utils.checkFetchResponseStatus)
            .then(() => {
                this._log('info', `response completely sent to remote proxy`);
            })
            .catch(error => {
                // final response body transfer to remote proxy failed.
                this._log('error', `transfer of response body to remote proxy encountered error`, error);
            })
        })
        .catch(error => {
            this._log('error', 'transfer of response headers to remote proxy unsuccesful', error);
        });
    }

    _log(level, msg, extra) {
        logger[level](`${this.requestMetadata.id}. ${this.requestMetadata.method}`,
            `${this.targetAppId}${this.requestMetadata.path} -`, msg, extra || '');
    }
}

module.exports = {
    WorkerDelegate
};