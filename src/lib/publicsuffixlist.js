'use strict';

;(function(root) {
var exceptions = new Map();
var rules = new Map();

var cutoffLength = 256;
var mustPunycode = /[^\w.*-]/;

function getDomain(hostname) {
    if ( !hostname || hostname.charAt(0) === '.' ) {
        return '';
    }
    hostname = hostname.toLowerCase();
    var suffix = getPublicSuffix(hostname);
    if ( suffix === hostname ) {
        return '';
    }
    var pos = hostname.lastIndexOf('.', hostname.lastIndexOf('.', hostname.length - suffix.length) - 1);
    if ( pos <= 0 ) {
        return hostname;
    }
    return hostname.slice(pos + 1);
}

function getPublicSuffix(hostname) {
    if ( !hostname ) {
        return '';
    }
    while ( true ) {
        let pos = hostname.indexOf('.');
        if ( pos < 0 ) {
            return hostname;
        }
        if ( search(exceptions, hostname) ) {
            return hostname.slice(pos + 1);
        }
        if ( search(rules, hostname) ) {
            return hostname;
        }
        if ( search(rules, '*' + hostname.slice(pos)) ) {
            return hostname;
        }
        hostname = hostname.slice(pos + 1);
    }
}

function search(store, hostname) {
    let tld, remainder;
    let pos = hostname.lastIndexOf('.');
    if ( pos === -1 ) {
        tld = hostname;
        remainder = hostname;
    } else {
        tld = hostname.slice(pos + 1);
        remainder = hostname.slice(0, pos);
    }
    let substore = store.get(tld);
    if ( substore === undefined ) {
        return false;
    }
    if ( typeof substore === 'string' ) {
        return substore.indexOf(' ' + remainder + ' ') >= 0;
    }
    let l = remainder.length;
    if ( l >= substore.length ) {
        return false;
    }
    let haystack = substore[l];
    if ( haystack === null ) {
        return false;
    }
    let left = 0;
    let right = Math.floor(haystack.length / l + 0.5);
    while ( left < right ) {
        let i = left + right >> 1;
        let needle = haystack.substr(l*i, l);
        if ( remainder < needle ) {
            right = i;
        } else if ( remainder > needle ) {
            left = i + 1;
        } else {
            return true;
        }
    }
    return false;
}

function parse(text, toAscii) {
    exceptions = new Map();
    rules = new Map();

    let lineBeg = 0;
    let textEnd = text.length;

    while ( lineBeg < textEnd ) {
        let lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = textEnd;
            }
        }
        let line = text.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;

        if ( line.length === 0 ) {
            continue;
        }

        let pos = line.indexOf('//');
        if ( pos !== -1 ) {
            line = line.slice(0, pos);
        }

        line = line.trim();
        if ( line.length === 0 ) {
            continue;
        }

        let store;
        if ( line.charAt(0) === '!' ) {
            store = exceptions;
            line = line.slice(1);
        } else {
            store = rules;
        }

        if ( mustPunycode.test(line) ) {
            line = toAscii(line);
        }

        line = line.toLowerCase();

        let tld;
        pos = line.lastIndexOf('.');
        if ( pos === -1 ) {
            tld = line;
        } else {
            tld = line.slice(pos + 1);
            line = line.slice(0, pos);
        }

        let substore = store.get(tld);
        if ( substore === undefined ) {
            store.set(tld, substore = []);
        }
        if ( line ) {
            substore.push(line);
        }
    }

    crystallize(exceptions);
    crystallize(rules);

    window.dispatchEvent(new CustomEvent('publicSuffixList'));
}

function crystallize(store) {
    for ( let entry of store ) {
        let tld = entry[0];
        let suffixes = entry[1];

        if ( suffixes.length === 0 ) {
            store.set(tld, '');
            continue;
        }

        let s = suffixes.join(' ');
        if ( s.length < cutoffLength ) {
            store.set(tld, ' ' + s + ' ');
            continue;
        }

        let buckets = [];
        for ( let suffix of suffixes ) {
            let l = suffix.length;
            if ( buckets.length <= l ) {
                extendArray(buckets, l);
            }
            if ( buckets[l] === null ) {
                buckets[l] = [];
            }
            buckets[l].push(suffix);
        }
        for ( let i = 0; i < buckets.length; i++ ) {
            let bucket = buckets[i];
            if ( bucket !== null ) {
                buckets[i] = bucket.sort().join('');
            }
        }
        store.set(tld, buckets);
    }

    return store;
}

let extendArray = function(aa, rb) {
    for ( let i = aa.length; i <= rb; i++ ) {
        aa.push(null);
    }
};

let selfieMagic = 3;

let toSelfie = function() {
    return {
        magic: selfieMagic,
        rules: Array.from(rules),
        exceptions: Array.from(exceptions)
    };
};

let fromSelfie = function(selfie) {
    if ( selfie instanceof Object === false || selfie.magic !== selfieMagic ) {
        return false;
    }
    rules = new Map(selfie.rules);
    exceptions = new Map(selfie.exceptions);
    window.dispatchEvent(new CustomEvent('publicSuffixList'));
    return true;
};

root = root || window;

root.publicSuffixList = {
    'version': '1.0',
    'parse': parse,
    'getDomain': getDomain,
    'getPublicSuffix': getPublicSuffix,
    'toSelfie': toSelfie,
    'fromSelfie': fromSelfie
};

})(this);
