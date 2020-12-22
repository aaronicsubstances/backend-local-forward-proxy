# backend-local-forward-proxy

Works together with [backend-reverse-proxy](https://github.com/aaronicsubstances/backend-reverse-proxy) to provide http proxy for web applications running on localhost.

## Setup

Launch with 
```
npm start
```

See .env.sample for available environment variables to use. The most important of them is CONNECTION_INFO_LIST, which has to be set for the application to run.   Also available is REQUEST_TIMEOUT_MILLIS, which defaults to 10 seconds.

The CONNECTION_INFO_LIST environment variable is a JSON array of nested arrays, where each nested array has 3 elements:

   * uuid/guid identifying a target url to a backend-reverse-proxy instance.
   * backend-reverse-proxy base url
   * target web application base url

To "comment out" a nested array, let its first item start with "#".    
