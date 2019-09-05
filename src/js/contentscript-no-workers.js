'use strict';

(function() {
    let html = document.documentElement;
    if ( html instanceof HTMLElement === false ) { return; }

    let meta;
    try {
        meta = document.createElement('meta');
    } catch(ex) {
    }
    if ( meta === undefined ) { return; }
    meta.setAttribute('http-equiv', 'content-security-policy');
    meta.setAttribute('content', "worker-src 'none'");

    let head = document.head,
        parent = head;
    if ( parent === null ) {
        parent = document.createElement('head');
        html.appendChild(parent);
    }
    parent.appendChild(meta);

    if ( head === null ) {
        html.removeChild(parent);
    } else {
        parent.removeChild(meta);
    }
})();
