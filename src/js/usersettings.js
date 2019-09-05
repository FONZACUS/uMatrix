'use strict';

µMatrix.changeUserSettings = function(name, value) {
    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    if ( this.userSettings[name] === undefined ) {
        return;
    }

    if ( value === undefined ) {
        return this.userSettings[name];
    }

    switch ( name ) {
    default:
        break;
    }

    this.userSettings[name] = value;

    switch ( name ) {
    case 'autoUpdate':
        this.scheduleAssetUpdater(value === true ? 120000 : 0);
        break;
    default:
        break;
    }

    this.saveUserSettings();
};
