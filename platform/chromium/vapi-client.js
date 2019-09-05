'use strict';

(function(self) {
if ( self.vAPI === undefined || self.vAPI.uMatrix !== true ) {
    self.vAPI = { uMatrix: true };
}

var vAPI = self.vAPI;
var chrome = self.chrome;

if ( vAPI.vapiClientInjected ) {
    return;
}
vAPI.vapiClientInjected = true;

vAPI.sessionId = String.fromCharCode(Date.now() % 26 + 97) +
                 Math.random().toString(36).slice(2);

vAPI.shutdown = (function() {
    var jobs = [];

    var add = function(job) {
        jobs.push(job);
    };

    var exec = function() {
        var job;
        while ( (job = jobs.pop()) ) {
            job();
        }
    };

    return {
        add: add,
        exec: exec
    };
})();

vAPI.messaging = {
    port: null,
    portTimer: null,
    portTimerDelay: 10000,
    listeners: new Set(),
    pending: new Map(),
    auxProcessId: 1,
    shuttingDown: false,

    shutdown: function() {
        this.shuttingDown = true;
        this.destroyPort();
    },

    disconnectListener: function() {
        this.port = null;
        vAPI.shutdown.exec();
    },
    disconnectListenerBound: null,

    messageListener: function(details) {
        if ( !details ) { return; }

        if ( details.broadcast ) {
            this.sendToListeners(details.msg);
            return;
        }

        var listener;
        if ( details.auxProcessId ) {
            listener = this.pending.get(details.auxProcessId);
            if ( listener !== undefined ) {
                this.pending.delete(details.auxProcessId);
                listener(details.msg);
                return;
            }
        }
    },
    messageListenerCallback: null,

    portPoller: function() {
        this.portTimer = null;
        if (
            this.port !== null &&
            this.listeners.size === 0 &&
            this.pending.size === 0
        ) {
            return this.destroyPort();
        }
        this.portTimer = vAPI.setTimeout(this.portPollerBound, this.portTimerDelay);
        this.portTimerDelay = Math.min(this.portTimerDelay * 2, 60 * 60 * 1000);
    },
    portPollerBound: null,

    destroyPort: function() {
        if ( this.portTimer !== null ) {
            clearTimeout(this.portTimer);
            this.portTimer = null;
        }
        var port = this.port;
        if ( port !== null ) {
            port.disconnect();
            port.onMessage.removeListener(this.messageListenerCallback);
            port.onDisconnect.removeListener(this.disconnectListenerBound);
            this.port = null;
        }
        this.listeners.clear();
        if ( this.pending.size !== 0 ) {
            var pending = this.pending;
            this.pending = new Map();
            for ( var callback of pending.values() ) {
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        }
    },

    createPort: function() {
        if ( this.shuttingDown ) { return null; }
        if ( this.messageListenerCallback === null ) {
            this.messageListenerCallback = this.messageListener.bind(this);
            this.disconnectListenerBound = this.disconnectListener.bind(this);
            this.portPollerBound = this.portPoller.bind(this);
        }
        try {
            this.port = chrome.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
            this.port = null;
        }
        if ( this.port !== null ) {
            this.port.onMessage.addListener(this.messageListenerCallback);
            this.port.onDisconnect.addListener(this.disconnectListenerBound);
            this.portTimerDelay = 10000;
            if ( this.portTimer === null ) {
                this.portTimer = vAPI.setTimeout(
                    this.portPollerBound,
                    this.portTimerDelay
                );
            }
        }
        return this.port;
    },

    getPort: function() {
        return this.port !== null ? this.port : this.createPort();
    },

    send: function(channelName, message, callback) {
        if ( this.pending.size > 25 ) {
            vAPI.shutdown.exec();
        }
        var port = this.getPort();
        if ( port === null ) {
            if ( typeof callback === 'function' ) { callback(); }
            return;
        }
        var auxProcessId;
        if ( callback ) {
            auxProcessId = this.auxProcessId++;
            this.pending.set(auxProcessId, callback);
        }
        port.postMessage({
            channelName: channelName,
            auxProcessId: auxProcessId,
            msg: message
        });
    },

    addListener: function(listener) {
        this.listeners.add(listener);
        this.getPort();
    },

    removeListener: function(listener) {
        this.listeners.delete(listener);
    },

    removeAllListeners: function() {
        this.listeners.clear();
    },

    sendToListeners: function(msg) {
        for ( var listener of this.listeners ) {
            listener(msg);
        }
    }
};

if ( window !== window.top ) {
    vAPI.shutdown.add(function() {
        vAPI = null;
    });
}

vAPI.setTimeout = vAPI.setTimeout || function(callback, delay) {
    setTimeout(function() { callback(); }, delay);
};

})(this);
