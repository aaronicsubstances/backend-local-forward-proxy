import { assert } from "chai";

import * as utils from "../src/utils";

describe('utils', function(){
    describe('#convertHeadersFromNativeToFetchFormat', function() {
        it('should convert successfully', function() {
            const input = [
                'date', '2019-03-18', 'date', '2020-12-12', 'server', 'nodejs'
            ];
            const expected = [
                [ 'date', '2019-03-18' ],
                [ 'date', '2020-12-12' ],
                [ 'server', 'nodejs' ]
            ];
            const actual = utils.convertHeadersFromNativeToFetchFormat(input);
            assert.deepEqual(actual, expected);
        });
    });

    describe('#calculateReconnectInterval', function() {
        it('should calculate correctly', function() {
            const data = [
                [0, 1000], [1, 2000],
                [2, 4000], [3, 8000],
                [4, 16000], [5, 30000]
            ];
            for (const testData of data) {
                const [ retryCount, expected ] = testData;
                const actual = utils.calculateReconnectInterval(retryCount);
                assert.equal(actual, expected);
            }
        })
    })
})