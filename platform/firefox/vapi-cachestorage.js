'use strict';

vAPI.cacheStorage = (function() {
    const STORAGE_NAME = 'uMatrixCacheStorage';
    var db;
    var pending = [];

    getDb(noopfn);

    return { get, set, remove, clear, getBytesInUse };

    function get(input, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( input === null ) {
            return getAllFromDb(callback);
        }
        var toRead, output = {};
        if ( typeof input === 'string' ) {
            toRead = [ input ];
        } else if ( Array.isArray(input) ) {
            toRead = input;
        } else {
            toRead = Object.keys(input);
            output = input;
        }
        return getFromDb(toRead, output, callback);
    }

    function set(input, callback) {
        putToDb(input, callback);
    }

    function remove(key, callback) {
        deleteFromDb(key, callback);
    }

    function clear(callback) {
        clearDb(callback);
    }

    function getBytesInUse(keys, callback) {
        callback(0);
    }

    function genericErrorHandler(error) {
        console.error('[%s]', STORAGE_NAME, error);
    }

    function noopfn() {
    }

    function processPendings() {
        var cb;
        while ( (cb = pending.shift()) ) {
            cb(db);
        }
    }

    function getDb(callback) {
        if ( pending === undefined ) {
            return callback();
        }
        if ( pending.length !== 0 ) {
            return pending.push(callback);
        }
        if ( db instanceof IDBDatabase ) {
            return callback(db);
        }
        pending.push(callback);
        if ( pending.length !== 1 ) { return; }
        var req;
        try {
            req = indexedDB.open(STORAGE_NAME, 1);
            if ( req.error ) {
                console.log(req.error);
                req = undefined;
            }
        } catch(ex) {
        }
        if ( req === undefined ) {
            processPendings();
            pending = undefined;
            return;
        }
        req.onupgradeneeded = function(ev) {
            req = undefined;
            db = ev.target.result;
            db.onerror = db.onabort = genericErrorHandler;
            var table = db.createObjectStore(STORAGE_NAME, { keyPath: 'key' });
            table.createIndex('value', 'value', { unique: false });
        };
        req.onsuccess = function(ev) {
            req = undefined;
            db = ev.target.result;
            db.onerror = db.onabort = genericErrorHandler;
            processPendings();
        };
        req.onerror = req.onblocked = function() {
            req = undefined;
            console.log(this.error);
            processPendings();
            pending = undefined;
        };
    }

    function getFromDb(keys, store, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( keys.length === 0 ) { return callback(store); }
        var gotOne = function() {
            if ( typeof this.result === 'object' ) {
                store[this.result.key] = this.result.value;
            }
        };
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = function() {
                return callback(store);
            };
            var table = transaction.objectStore(STORAGE_NAME);
            for ( var key of keys ) {
                var req = table.get(key);
                req.onsuccess = gotOne;
                req.onerror = noopfn;
                req = undefined;
            }
        });
    }

    function getAllFromDb(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var output = {};
            var transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = function() {
                callback(output);
            };
            var table = transaction.objectStore(STORAGE_NAME),
                req = table.openCursor();
            req.onsuccess = function(ev) {
                var cursor = ev.target.result;
                if ( !cursor ) { return; }
                output[cursor.key] = cursor.value;
                cursor.continue();
            };
        });
    }

    function putToDb(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        var keys = Object.keys(input);
        if ( keys.length === 0 ) { return callback(); }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var transaction = db.transaction(STORAGE_NAME, 'readwrite');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = callback;
            var table = transaction.objectStore(STORAGE_NAME);
            for ( var key of keys ) {
                var entry = {};
                entry.key = key;
                entry.value = input[key];
                table.put(entry);
                entry = undefined;
            }
        });
    }

    function deleteFromDb(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        var keys = Array.isArray(input) ? input.slice() : [ input ];
        if ( keys.length === 0 ) { return callback(); }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var transaction = db.transaction(STORAGE_NAME, 'readwrite');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = callback;
            var table = transaction.objectStore(STORAGE_NAME);
            for ( var key of keys ) {
                table.delete(key);
            }
        });
    }

    function clearDb(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var req = db.transaction(STORAGE_NAME, 'readwrite')
                        .objectStore(STORAGE_NAME)
                        .clear();
            req.onsuccess = req.onerror = callback;
        });
    }
}());
