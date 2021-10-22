import AbortController from "abort-controller";
import fetch from "node-fetch";
import { Readable } from "stream";

import * as logger from "./logger";
import { FowardRequestCallback, PendingTransfer } from "./types";
import * as utils from  "./utils";

export function forwardRequest(
        targetAppBaseUrl: string, 
        pendingTransfer: PendingTransfer, 
        body: Readable,
        cb: FowardRequestCallback) {
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
                "indicating non empty body. request will fail in all likelihood: %j",
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
    .then((res: any) => {
        // send back any response code, even 4xx and 5xx ones.
        cb(null, res);
    })
    .catch((error: Error) => {
        // request to target API failed.
        cb(error, null);
    })
    .finally(() => {
        clearTimeout(timeout);
    });
}