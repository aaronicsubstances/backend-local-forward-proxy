const dotenv = require('dotenv')
const fetch = require("node-fetch");

const logger = require("./logger");
const utils = require("./utils");
const RequestTransferHandler = require("./request-transfer-handler");

dotenv.config();

class RemoteProxyConnection {
    constructor(backendId, remoteBaseUrl, localBaseUrl) {
        this.failureCount = 0;
        this.backendId = backendId;
        this.remoteBaseUrl = remoteBaseUrl;
        this.localBaseUrl = localBaseUrl;
    }

    start() {
        this._reconnect(true);
    }

    _reconnect(prevAttemptSucceeded) {
        if (prevAttemptSucceeded) {
            this.failureCount = 0;
        }
        else {
            this.failureCount++;
        }
        const fetchUrl = `${this.remoteBaseUrl}/req-h/${this.backendId}`;
        fetch(fetchUrl)
            .then(utils.checkFetchResponseStatus)
            .then(res => res.json())
            .then(res => {
                if (res.id) {
                    logger.debug(`pending request found for backend ${this.backendId} with id ${res.id}`);
                    new RequestTransferHandler(this.backendId,
                        this.remoteBaseUrl, this.localBaseUrl, res).start();
                }
                else {
                    // no work found.
                    logger.debug(`no pending request found for backend ${this.backendId}`);
                }
                this._reconnect(true);
            })
            .catch(err => {
                if (err.name === 'FetchError') {
                    logger.warn(`Unsuccessful fetch for backend ${this.backendId}:`, err.message);
                }
                else {
                    logger.error(`An error occured during fetch for backend ${this.backendId}`, err);
                }
                
                // delay for some time before reconnecting.
                const that = this;
                setTimeout(() => that._reconnect(false), utils.calculateReconnectInterval(this.failureCount));
            });
    }
}

const connInfoList = utils.getConnectionInfoList();
logger.info(`Found ${connInfoList.length} long polling connections to create`);
for (const connInfo of connInfoList) {
    new RemoteProxyConnection(connInfo[0], connInfo[1], connInfo[2]).start();
}

// prevent script from exiting.
const SOME_HUGE_INTERVAL = 1 << 30;
setInterval(() => {}, SOME_HUGE_INTERVAL);