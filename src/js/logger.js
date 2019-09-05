'use strict';

µMatrix.logger = (function() {
    let LogEntry = function(details) {
        this.init(details);
    };

    LogEntry.prototype.init = function(details) {
        this.tstamp = Date.now();
        this.details = JSON.stringify(details);
    };

    let buffer = null;
    let lastReadTime = 0;
    let writePtr = 0;

    let logBufferObsoleteAfter = 30 * 1000;

    let janitor = function() {
        if (
            buffer !== null &&
            lastReadTime < (Date.now() - logBufferObsoleteAfter)
        ) {
            buffer = null;
            writePtr = 0;
            api.ownerId = undefined;
            api.enabled = false;
        }
        if ( buffer !== null ) {
            vAPI.setTimeout(janitor, logBufferObsoleteAfter);
        }
    };

    let api = {
        enabled: false,
        ownerId: undefined,
        writeOne: function(details) {
            if ( buffer === null ) { return; }
            if ( writePtr === buffer.length ) {
                buffer.push(new LogEntry(details));
            } else {
                buffer[writePtr].init(details);
            }
            writePtr += 1;
        },
        readAll: function(ownerId) {
            this.ownerId = ownerId;
            this.enabled = true;
            if ( buffer === null ) {
                buffer = [];
                vAPI.setTimeout(janitor, logBufferObsoleteAfter);
            }
            let out = buffer.slice(0, writePtr);
            writePtr = 0;
            lastReadTime = Date.now();
            return out;
        },
    };

    return api;
})();
