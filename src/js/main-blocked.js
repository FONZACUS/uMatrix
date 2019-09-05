'use strict';

(function() {
let details = {};

(function() {
    let matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches === null ) { return; }
    try {
        details = JSON.parse(atob(matches[1]));
    } catch(ex) {
    }
})();

uDom('.what').text(details.url);

(function() {
    let reURL = /^https?:\/\//;

    let liFromParam = function(name, value) {
        if ( value === '' ) {
            value = name;
            name = '';
        }
        let li = document.createElement('li');
        let span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = document.createElement('span');
        if ( reURL.test(value) ) {
            let a = document.createElement('a');
            a.href = a.textContent = value;
            span.appendChild(a);
        } else {
            span.textContent = value;
        }
        li.appendChild(span);
        return li;
    };

    let safeDecodeURIComponent = function(s) {
        try {
            s = decodeURIComponent(s);
        } catch (ex) {
        }
        return s;
    };

    let renderParams = function(parentNode, rawURL) {
        let a = document.createElement('a');
        a.href = rawURL;
        if ( a.search.length === 0 ) { return false; }

        let pos = rawURL.indexOf('?');
        let li = liFromParam(
            vAPI.i18n('mainBlockedNoParamsPrompt'),
            rawURL.slice(0, pos)
        );
        parentNode.appendChild(li);

        let params = a.search.slice(1).split('&');
        for ( var i = 0; i < params.length; i++ ) {
            let param = params[i];
            let pos = param.indexOf('=');
            if ( pos === -1 ) {
                pos = param.length;
            }
            let name = safeDecodeURIComponent(param.slice(0, pos));
            let value = safeDecodeURIComponent(param.slice(pos + 1));
            li = liFromParam(name, value);
            if ( reURL.test(value) ) {
                let ul = document.createElement('ul');
                renderParams(ul, value);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }
        return true;
    };

    let hasParams = renderParams(uDom.nodeFromId('parsed'), details.url);
    if ( hasParams === false ) { return; }

    let theURLNode = document.getElementById('theURL');
    theURLNode.classList.add('hasParams');
    theURLNode.classList.toggle(
        'collapsed',
        vAPI.localStorage.getItem('document-blocked-collapse-url') === 'true'
    );

    let toggleCollapse = function() {
        vAPI.localStorage.setItem(
            'document-blocked-collapse-url',
            theURLNode.classList.toggle('collapsed').toString()
        );
    };

    theURLNode.querySelector('.collapse').addEventListener(
        'click',
        toggleCollapse
    );
    theURLNode.querySelector('.expand').addEventListener(
        'click',
        toggleCollapse
    );
})();

if ( window.history.length > 1 ) {
    uDom('#back').on('click', function() { window.history.back(); });
    uDom('#bye').css('display', 'none');
} else {
    uDom('#bye').on('click', function() { window.close(); });
    uDom('#back').css('display', 'none');
}

vAPI.messaging.send('main-blocked.js', {
    what: 'mustBlock',
    scope: details.hn,
    hostname: details.hn,
    type: details.type
}, response => {
    if ( response === false ) {
        window.location.replace(details.url);
    }
});

})();
