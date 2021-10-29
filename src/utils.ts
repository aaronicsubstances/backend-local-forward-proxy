export function convertHeadersFromNativeToFetchFormat(nativeHeaders: Array<string>) {
    // skip host and connection headers. host interferes with TLS expectations.
    const fetchHeaders = new Array<Array<string>>();
    for (let i = 0; i < nativeHeaders.length; i += 2) {
        if (/^(host|connection)$/i.test(nativeHeaders[i])) {
            continue;
        }
        fetchHeaders.push([ nativeHeaders[i], nativeHeaders[i + 1] ]);
    }
    return fetchHeaders;
}

export function calculateReconnectInterval(retryCount: number) {
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

export function checkFetchResponseStatus(res: any) {    
    if (res.ok) { // res.status >= 200 && res.status < 300
        return res;
    }
    else {
        throw new Error(res.statusText);
    }
}