'use strict';

µMatrix.URI = (function() {
var reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;

var reSchemeFromURI = /^[^:\/?#]+:/;
var reAuthorityFromURI = /^(?:[^:\/?#]+:)?(\/\/[^\/?#]+)/;
var reCommonHostnameFromURL = /^https?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])\//;
var reMustNormalizeHostname = /[^0-9a-z._-]/;

var reHostPortFromAuthority = /^(?:[^@]*@)?([^:]*)(:\d*)?$/;
var reIPv6PortFromAuthority = /^(?:[^@]*@)?(\[[0-9a-f:]*\])(:\d*)?$/i;

var reHostFromNakedAuthority = /^[0-9a-z._-]+[0-9a-z]$/i;
var reHostFromAuthority = /^(?:[^@]*@)?([^:]+)(?::\d*)?$/;
var reIPv6FromAuthority = /^(?:[^@]*@)?(\[[0-9a-f:]+\])(?::\d*)?$/i;

var reIPAddressNaive = /^\d+\.\d+\.\d+\.\d+$|^\[[\da-zA-Z:]+\]$/;

var reset = function(o) {
    o.scheme = '';
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    o.path = '';
    o.query = '';
    o.fragment = '';
    return o;
};

var resetAuthority = function(o) {
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    return o;
};

var URI = {
    scheme: '',
    authority: '',
    hostname: '',
    _ipv4: undefined,
    _ipv6: undefined,
    port: '',
    domain: undefined,
    path: '',
    query: '',
    fragment: '',
    schemeBit: (1 << 0),
    userBit: (1 << 1),
    passwordBit: (1 << 2),
    hostnameBit: (1 << 3),
    portBit: (1 << 4),
    pathBit: (1 << 5),
    queryBit: (1 << 6),
    fragmentBit: (1 << 7),
    allBits: (0xFFFF)
};

URI.authorityBit = (URI.userBit | URI.passwordBit | URI.hostnameBit | URI.portBit);
URI.normalizeBits = (URI.schemeBit | URI.hostnameBit | URI.pathBit | URI.queryBit);

URI.set = function(uri) {
    if ( uri === undefined ) {
        return reset(URI);
    }
    var matches = reRFC3986.exec(uri);
    if ( !matches ) {
        return reset(URI);
    }
    this.scheme = matches[1] !== undefined ? matches[1].slice(0, -1) : '';
    this.authority = matches[2] !== undefined ? matches[2].slice(2).toLowerCase() : '';
    this.path = matches[3] !== undefined ? matches[3] : '';

    if ( this.authority !== '' && this.path === '' ) {
        this.path = '/';
    }
    this.query = matches[4] !== undefined ? matches[4].slice(1) : '';
    this.fragment = matches[5] !== undefined ? matches[5].slice(1) : '';

    if ( reHostFromNakedAuthority.test(this.authority) ) {
        this.hostname = this.authority;
        this.port = '';
        return this;
    }
    matches = reHostPortFromAuthority.exec(this.authority);
    if ( !matches ) {
        matches = reIPv6PortFromAuthority.exec(this.authority);
        if ( !matches ) {
            return resetAuthority(URI);
        }
    }
    this.hostname = matches[1] !== undefined ? matches[1] : '';
    if ( this.hostname.slice(-1) === '.' ) {
        this.hostname = this.hostname.slice(0, -1);
    }
    this.port = matches[2] !== undefined ? matches[2].slice(1) : '';
    return this;
};

URI.assemble = function(bits) {
    if ( bits === undefined ) {
        bits = this.allBits;
    }
    var s = [];
    if ( this.scheme && (bits & this.schemeBit) ) {
        s.push(this.scheme, ':');
    }
    if ( this.hostname && (bits & this.hostnameBit) ) {
        s.push('//', this.hostname);
    }
    if ( this.port && (bits & this.portBit) ) {
        s.push(':', this.port);
    }
    if ( this.path && (bits & this.pathBit) ) {
        s.push(this.path);
    }
    if ( this.query && (bits & this.queryBit) ) {
        s.push('?', this.query);
    }
    if ( this.fragment && (bits & this.fragmentBit) ) {
        s.push('#', this.fragment);
    }
    return s.join('');
};

URI.schemeFromURI = function(uri) {
    var matches = reSchemeFromURI.exec(uri);
    if ( matches === null ) {
        return '';
    }
    return matches[0].slice(0, -1).toLowerCase();
};

const reNetworkScheme = /^(?:https?|wss?|ftps?)\b/;

URI.isNetworkScheme = function(scheme) {
    return reNetworkScheme.test(scheme);
};

URI.isSecureScheme = function(scheme) {
    return this.reSecureScheme.test(scheme);
};

URI.reSecureScheme = /^(?:https|wss|ftps)\b/;

URI.hostnameFromURI = function(uri) {
    var matches = reCommonHostnameFromURL.exec(uri);
    if ( matches !== null ) { return matches[1]; }
    matches = reAuthorityFromURI.exec(uri);
    if ( matches === null ) { return ''; }
    var authority = matches[1].slice(2);
    if ( reHostFromNakedAuthority.test(authority) ) {
        return authority.toLowerCase();
    }
    matches = reHostFromAuthority.exec(authority);
    if ( matches === null ) {
        matches = reIPv6FromAuthority.exec(authority);
        if ( matches === null ) { return ''; }
    }
    var hostname = matches[1];
    while ( hostname.endsWith('.') ) {
        hostname = hostname.slice(0, -1);
    }
    if ( reMustNormalizeHostname.test(hostname) ) {
        hostname = punycode.toASCII(hostname.toLowerCase());
    }
    return hostname;
};

URI.domainFromHostname = function(hostname) {
    var entry = domainCache.get(hostname);
    if ( entry !== undefined ) {
        entry.tstamp = Date.now();
        return entry.domain;
    }
    if ( reIPAddressNaive.test(hostname) === false ) {
        return domainCacheAdd(hostname, psl.getDomain(hostname));
    }
    return domainCacheAdd(hostname, hostname);
};

var psl = publicSuffixList;

var domainCache = new Map();
var domainCacheCountLowWaterMark = 75;
var domainCacheCountHighWaterMark = 100;
var domainCacheEntryJunkyard = [];
var domainCacheEntryJunkyardMax = domainCacheCountHighWaterMark - domainCacheCountLowWaterMark;

var DomainCacheEntry = function(domain) {
    this.init(domain);
};

DomainCacheEntry.prototype.init = function(domain) {
    this.domain = domain;
    this.tstamp = Date.now();
    return this;
};

DomainCacheEntry.prototype.dispose = function() {
    this.domain = '';
    if ( domainCacheEntryJunkyard.length < domainCacheEntryJunkyardMax ) {
        domainCacheEntryJunkyard.push(this);
    }
};

var domainCacheEntryFactory = function(domain) {
    var entry = domainCacheEntryJunkyard.pop();
    if ( entry ) {
        return entry.init(domain);
    }
    return new DomainCacheEntry(domain);
};

var domainCacheAdd = function(hostname, domain) {
    var entry = domainCache.get(hostname);
    if ( entry !== undefined ) {
        entry.tstamp = Date.now();
    } else {
        domainCache.set(hostname, domainCacheEntryFactory(domain));
        if ( domainCache.size === domainCacheCountHighWaterMark ) {
            domainCachePrune();
        }
    }
    return domain;
};

var domainCacheEntrySort = function(a, b) {
    return domainCache.get(b).tstamp - domainCache.get(a).tstamp;
};

var domainCachePrune = function() {
    var hostnames = Array.from(domainCache.keys())
                         .sort(domainCacheEntrySort)
                         .slice(domainCacheCountLowWaterMark);
    var i = hostnames.length;
    var hostname;
    while ( i-- ) {
        hostname = hostnames[i];
        domainCache.get(hostname).dispose();
        domainCache.delete(hostname);
    }
};

window.addEventListener('publicSuffixList', function() {
    domainCache.clear();
});

URI.domainFromURI = function(uri) {
    if ( !uri ) {
        return '';
    }
    return this.domainFromHostname(this.hostnameFromURI(uri));
};

URI.normalizedURI = function() {
    return this.assemble(this.normalizeBits);
};

URI.toString = function() {
    return this.assemble();
};

return URI;

})();
