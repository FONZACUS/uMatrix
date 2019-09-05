'use strict';

(function() {
    if ( typeof vAPI !== 'object' ) { return; }

    vAPI.selfWorkerSrcReported = vAPI.selfWorkerSrcReported || false;

    var reGoodWorkerSrc = /(?:child|worker)-src[^;,]+?'none'/;

    var handler = function(ev) {
        if (
            ev.isTrusted !== true ||
            ev.originalPolicy.includes('report-uri about:blank') === false
        ) {
            return false;
        }

        if (
            ev.effectiveDirective.startsWith('worker-src') === false &&
            ev.effectiveDirective.startsWith('child-src') === false
        ) {
            return false;
        }

        if ( reGoodWorkerSrc.test(ev.originalPolicy) === false ) {
            return false;
        }

        if ( ev.blockedURI.includes('://') === false ) {
            if ( vAPI.selfWorkerSrcReported ) { return true; }
            vAPI.selfWorkerSrcReported = true;
        }

        vAPI.messaging.send(
            'contentscript.js',
            {
                what: 'securityPolicyViolation',
                directive: 'worker-src',
                blockedURI: ev.blockedURI,
                documentURI: ev.documentURI,
                blocked: ev.disposition === 'enforce'
            }
        );

        return true;
    };

    document.addEventListener(
        'securitypolicyviolation',
        function(ev) {
            if ( !handler(ev) ) { return; }
            ev.stopPropagation();
            ev.preventDefault();
        },
        true
    );

})();
