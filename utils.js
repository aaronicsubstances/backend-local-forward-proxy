function getRequestTimeoutMillis() {
    return parseInt(process.env.REQUEST_TIMEOUT_MILLIS) || 10000;
}

function getMaxTargetConnectionCount() {
    return parseInt(process.env.MAX_TARGET_CONNECTION_COUNT) || 5;
}

function getConnectionInfoList() {
    const connInfoList = JSON.parse(process.env.CONNECTION_INFO_LIST || '[]');
    
    // remove trailing slashes from base urls.
    for (const connInfo of connInfoList) {
        if (connInfo.reverseProxyBaseUrl.endsWith("/")) {
            connInfo.reverseProxyBaseUrl = connInfo.reverseProxyBaseUrl.substring(0,
                connInfo.reverseProxyBaseUrl.length - 1);
        }
        if (connInfo.targetAppBaseUrl.endsWith("/")) {
            connInfo.targetAppBaseUrl = connInfo.targetAppBaseUrl.substring(0,
                connInfo.targetAppBaseUrl.length - 1);
        }
    }
    return connInfoList;
}

function convertHeadersFromNativeToFetchFormat(nativeHeaders) {
    // skip host and connection headers. host interferes with TLS expectations.
    const fetchHeaders = new Array();
    for (let i = 0; i < nativeHeaders.length; i += 2) {
        if (/^(host|connection)$/i.test(nativeHeaders[i])) {
            continue;
        }
        fetchHeaders.push([ nativeHeaders[i], nativeHeaders[i + 1] ]);
    }
    return fetchHeaders;
}

function arrayRemove(arr, value) {
    for (let i = 0; i < arr.length; i++) {
        if ( arr[i] === value) {
            arr.splice(i, 1);
            i--;
        }
    }
}

function calculateReconnectInterval(retryCount) {
    // use exponential backoff
    let time = 1000;
    const maxTime = 30000;
    let i = 0;
    while (time < maxTime && i < retryCount) {
        time *= 2;
        i++;
    }
    return Math.min(time, maxTime);
}

function checkFetchResponseStatus(res) {    
    if (res.ok) { // res.status >= 200 && res.status < 300
        return res;
    }
    else {
        throw new Error(res.statusText);
    }
}

module.exports = {
    getRequestTimeoutMillis,
    getConnectionInfoList,
    convertHeadersFromNativeToFetchFormat,
    arrayRemove,
    calculateReconnectInterval,
    checkFetchResponseStatus,
    getMaxTargetConnectionCount
};