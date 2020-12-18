const AbortController = require("abort-controller");
const fetch = require("node-fetch");

const logger = require("./logger");
const utils = require("./utils");

class RequestTransferHandler {
    constructor(backendId, remoteBaseUrl, localBaseUrl, requestMetadata) {
        this.backendId = backendId;
        this.remoteBaseUrl = remoteBaseUrl;
        this.localBaseUrl = localBaseUrl;
        this.requestMetadata = requestMetadata;
    }

    start() {
        const fetchRequestBodyUrl = `${this.remoteBaseUrl}/req-b/${this.backendId}/${this.requestMetadata.id}`;
        fetch(fetchRequestBodyUrl)
            .then(utils.checkFetchResponseStatus)
            .then(reqBodyFetchRes => {
                this._logSuccess(`Fetch of request body from remote proxy successful`);

                const targetUrl = this.localBaseUrl + this.requestMetadata.path;
                const headers = utils.convertHeadersFromNativeToFetchFormat(this.requestMetadata.headers);

                // because node-fetch throws error if "GET" or "HEAD" request is made
                // with a non-null body, even if null, rather than skip accepting bodies
                // for those verbs, we will rather make it fail
                // when there's a body around as indicated by content-length
                let useBody = true;
                if (["GET", "HEAD"].includes(this.requestMetadata.method)) {
                    useBody = false;
                    const contentLenHeader = headers.find(x => /content-length/i.test(x[0]));
                    if (contentLenHeader && contentLenHeader[1]) {
                        useBody = true;
                    }
                }
                
                const abortController = new AbortController();
                const timeout = setTimeout(() => {
                    abortController.abort();
                }, utils.getRequestTimeoutMillis());

                fetch(targetUrl, {
                    method: this.requestMetadata.method,
                    headers,
                    body: useBody ? reqBodyFetchRes : null,
                    signal: abortController.signal
                })
                .then(res => {
                    // send back any response code, even 4xx and 5xx ones.
                    this._logSuccess(`Request to local endpoint ${targetUrl} has returned.`);
                    this._transferResponse(res);
                })
                .catch(error => {
                    // request to localhost API failed.
                    if (error.name === "AbortError") {
                        this._logFailure(`Request to local endpoint ${targetUrl} timed out`);
                    }
                    else {
                        this._logFailure(`Request to local endpoint ${targetUrl} encountered error`, error);
                    }
                })
                .finally(() => {
                    clearTimeout(timeout);
                });
            })
            .catch(error => {
                // fetching of request body from remote proxy failed.
                this._logFailure(`Fetch of request body from remote proxy unsuccessful`, error);
            });
    }

    _transferResponse(res) {
        const transferResponseMetadataUrl = `${this.remoteBaseUrl}/res-h/${this.backendId}`;
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
            this._logSuccess(`response headers successfully sent to remote proxy`);
            const transferResponseBodyUrl = `${this.remoteBaseUrl}/res-b/${this.backendId}/${this.requestMetadata.id}`;
            fetch(transferResponseBodyUrl, {
                method: "POST",
                body: res.body,
                // very important to set content type as binary so that body parsers
                // in remote proxy can leave it alone.
                headers: { 'Content-Type': 'application/octet-stream' }
            })
            .then(utils.checkFetchResponseStatus)
            .then(() => {
                this._logSuccess(`response body successfully sent to remote proxy`);
            })
            .catch(error => {
                // final response body transfer to remote proxy failed.
                this._logFailure(`transfer of response body to remote proxy encountered error`, error);
            })
        })
        .catch(error => {
            this._logFailure('transfer of response headers to remote proxy unsuccesful', error);
        });
    }

    _logSuccess(msg) {
        logger.info(`backend ${this.backendId} - ${this.requestMetadata.id}. ${this.requestMetadata.method}`,
            `"${this.requestMetadata.path}" -`, msg);
    }

    _logFailure(msg, err) {
        logger.error(`backend ${this.backendId} - ${this.requestMetadata.id}. ${this.requestMetadata.method}`,
            `"${this.requestMetadata.path}" -`, msg, err);
    }
}

module.exports = RequestTransferHandler;