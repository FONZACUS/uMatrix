'use strict';

(function(context) {
    context.DIFF_INSERT = 1;
    context.DIFF_DELETE = -1;
    context.DIFF_EQUAL = 0;
    context.diff_match_patch = function(){};

    context.diff_match_patch.prototype.diff_main = function(a, b) {
        if ( a === b ) { return [ [ 0, a ] ]; }
        var aa = a.match(/\n|[^\n]+\n?/g) || [];
        var bb = b.match(/\n|[^\n]+\n?/g) || [];
        var d = new Diff(aa, bb, eqlDefault);
        return d.editscript();
    };

    function eqlDefault(a, b) { return a === b; }

    function Diff(a, b, eql) {
        this.a = a;
        this.b = b;
        this.eql = eql;

        this.moda = Array.apply(null, new Array(a.length)).map(true.valueOf, false);
        this.modb = Array.apply(null, new Array(b.length)).map(true.valueOf, false);

        this.down = {};
        this.up = {};

        this.lcs(0, a.length, 0, b.length);
    }

    Diff.prototype.editscript = function Diff_editscript() {
        var moda = this.moda, modb = this.modb;
        var astart = 0, aend = moda.length;
        var bstart = 0, bend = modb.length;
        var result = [];
        while (astart < aend || bstart < bend) {
            if (astart < aend && bstart < bend) {
                if (!moda[astart] && !modb[bstart]) {
                    result.push([ 0, this.a[astart] ]);
                    astart++; bstart++;
                    continue;
                } else if (moda[astart] && modb[bstart]) {
                    result.push([ -1, this.a[astart] ]);
                    result.push([ 1, this.b[bstart] ]);
                    astart++; bstart++;
                    continue;
                }
            }
            if (astart < aend && (bstart >= bend || moda[astart])) {
                result.push([ -1, this.a[astart] ]);
                astart++;
            }
            if (bstart < bend && (astart >= aend || modb[bstart])) {
                result.push([ 1, this.b[bstart] ]);
                bstart++;
            }
        }
        return result;
    };

    Diff.prototype.lcs = function Diff_lcs(astart, aend, bstart, bend) {
        var a = this.a, b = this.b, eql = this.eql;
        while (astart < aend && bstart < bend && eql(a[astart], b[bstart])) {
            astart++; bstart++;
        }
        while (astart < aend && bstart < bend && eql(a[aend - 1], b[bend - 1])) {
            aend--; bend--;
        }

        if (astart === aend) {
            while (bstart < bend) {
                this.modb[bstart] = true;
                bstart++;
            }
        } else if (bend === bstart) {
            while (astart < aend) {
                this.moda[astart] = true;
                astart++;
            }
        } else {
            var snake = this.snake(astart, aend, bstart, bend);

            this.lcs(astart, snake.x, bstart, snake.y);
            this.lcs(snake.u, aend, snake.v, bend);
        }
    };

    Diff.prototype.snake = function Diff_snake(astart, aend, bstart, bend) {
        var a = this.a, b = this.b, eql = this.eql;

        var N = aend - astart,
            M = bend - bstart;

        var kdown = astart - bstart;
        var kup = aend - bend;

        var delta = N - M;
        var deltaOdd = delta & 1;

        var down = this.down;
        down[kdown + 1] = astart;
        var up = this.up;
        up[kup - 1] = aend;

        var Dmax = (N + M + 1) / 2;
        for (var D = 0; D <= Dmax; D++) {
            var k, x, y;
            for (k = kdown - D; k <= kdown + D; k += 2) {
                if (k === kdown - D) {
                    x = down[k + 1];
                } else {
                    x = down[k - 1] + 1;
                    if ((k < kdown + D) && (down[k + 1] >= x)) {
                        x = down[k + 1];
                    }
                }
                y = x - k;

                while (x < aend && y < bend && eql(a[x], b[y])) {
                    x++; y++;
                }
                down[k] = x;

                if (deltaOdd && (kup - D < k) && (k < kup + D) &&
                    up[k] <= down[k]) {
                    return {
                        x: down[k],
                        y: down[k] - k,
                        u: up[k],
                        v: up[k] - k,
                    };
                }
            }

            for (k = kup - D; k <= kup + D; k += 2) {
                if (k === kup + D) {
                    x = up[k - 1];
                } else {
                    x = up[k + 1] - 1;
                    if ((k > kup - D) && (up[k - 1] < x)) {
                        x = up[k - 1];
                    }
                }
                y = x - k;

                while (x > astart && y > bstart && eql(a[x - 1], b[y - 1])) {
                    x--; y--;
                }
                up[k] = x;

                if (!deltaOdd && (kdown - D <= k) && (k <= kdown + D) &&
                    up[k] <= down[k]) {
                    return {
                        x: down[k],
                        y: down[k] - k,
                        u: up[k],
                        v: up[k] - k,
                    };
                }
            }
        }
    };

    return Diff;
})(self);
