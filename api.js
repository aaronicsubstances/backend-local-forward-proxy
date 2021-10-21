const AbortController = require("abort-controller");
const fetch = require("node-fetch");

const logger = require("./logger");
const utils = require("./utils");

function forwardRequest(targetAppBaseUrl, pendingTransfer, body, cb) {
    const targetUrl = `${targetAppBaseUrl}${pendingTransfer.path}`;
    const method = pendingTransfer.method;
    const headers = utils.convertHeadersFromNativeToFetchFormat(pendingTransfer.headers);

    // because node-fetch throws error if "GET" or "HEAD" request is made
    // with a non-null body, even if null, rather than skip accepting bodies
    // for those verbs, we will rather make it fail
    // when there's a body around as indicated by content-length
    let useBody = true;
    if (["GET", "HEAD"].includes(method)) {
        useBody = false;
        const contentLenHeader = headers.find(x => /content-length/i.test(x[0]));
        if (contentLenHeader && contentLenHeader[1]) {
            logger.warn("encountered GET/HEAD request with content-length " +
                "indicating non empty body. request will fail in all likelihood: " +
                contentLenHeader);
            useBody = true;
        }
    }
    
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
        abortController.abort();
    }, utils.getRequestTimeoutMillis());

    fetch(targetUrl, {
        method,
        headers,
        body: useBody ? body : null,
        signal: abortController.signal
    })
    .then(res => {
        // send back any response code, even 4xx and 5xx ones.
        cb(null, res);
    })
    .catch(error => {
        // request to target API failed.
        cb(error);
    })
    .finally(() => {
        clearTimeout(timeout);
    });
}

module.exports = {
    forwardRequest
};