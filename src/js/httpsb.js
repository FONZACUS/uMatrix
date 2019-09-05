'use strict';

(function() {
    var µm = µMatrix;
    µm.pMatrix = new µm.Matrix();
    µm.pMatrix.setCell('*', '*', '*', µm.Matrix.Red);

    µm.tMatrix = new µm.Matrix();
    µm.tMatrix.assign(µm.pMatrix);
})();

µMatrix.hostnameFromURL = function(url) {
    var hn = this.URI.hostnameFromURI(url);
    return hn === '' ? '*' : hn;
};

µMatrix.mustBlock = function(srcHostname, desHostname, type) {
    return this.tMatrix.mustBlock(srcHostname, desHostname, type);
};

µMatrix.mustAllow = function(srcHostname, desHostname, type) {
    return this.mustBlock(srcHostname, desHostname, type) === false;
};

µMatrix.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = '>' + s.slice(0,1) + 'K';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + 'K';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'K';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + 'M';
        } else {
            s = s.slice(0,-6) + 'M';
        }
    }
    return s;
};
