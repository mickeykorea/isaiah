// Typewriter effect
var TxtType = function (el, toRotate, period) {
    this.toRotate = toRotate;
    this.el = el;
    this.loopNum = 0;
    this.period = parseInt(period, 10) || 1000;
    this.txt = '';
    this.isDeleting = false;

    // Show only cursor first
    this.el.innerHTML = '<span class="wrap"><span class="cursor">●</span></span>';

    // Delay the start of typing
    setTimeout(() => {
        this.tick();
    }, 1500);
};

TxtType.prototype.tick = function () {
    var i = this.loopNum % this.toRotate.length;
    var fullTxt = this.toRotate[i];

    if (this.isDeleting) {
        this.txt = fullTxt.substring(0, this.txt.length - 1);
    } else {
        this.txt = fullTxt.substring(0, this.txt.length + 1);
    }

    // Using a dot (•) for the cursor
    this.el.innerHTML = '<span class="wrap">' + this.txt + '<span class="cursor">●</span></span>';

    var that = this;
    var delta = 50 - Math.random() * 25;

    if (this.isDeleting) { delta /= 2; }

    if (!this.isDeleting && this.txt === fullTxt) {
        delta = this.period;
        this.isDeleting = false;

        // Remove cursor after seconds when typing is complete
        setTimeout(() => {
            this.el.innerHTML = '<span class="wrap">' + this.txt + '<span class="cursor-static">●</span></span>';
        }, 500);

        return; // Stop the typing animation
    } else if (this.isDeleting && this.txt === '') {
        this.isDeleting = false;
        this.loopNum++;
        delta = 100;
    }

    setTimeout(function () {
        that.tick();
    }, delta);
};

window.onload = function () {
    var elements = document.getElementsByClassName('typewrite');
    for (var i = 0; i < elements.length; i++) {
        var toRotate = elements[i].getAttribute('data-type');
        var period = elements[i].getAttribute('data-period');
        if (toRotate) {
            new TxtType(elements[i], JSON.parse(toRotate), period);
        }
    }
    // INJECT CSS
    var css = document.createElement("style");
    css.type = "text/css";
    css.innerHTML = `
        .typewrite > .wrap {
            position: relative;
        }
        .cursor {
            display: inline-block;
            margin-left: 3px;
            font-size: 20px;
            vertical-align: middle;
            opacity: 1;
            animation: blink 0.75s step-end infinite;
        }
        .cursor-static {
            display: inline-block;
            margin-left: 3px;
            font-size: 20px;
            vertical-align: middle;
            opacity: 0; /* Make the cursor transparent */
        }

        @keyframes blink {
            from, to { opacity: 1; }
            50% { opacity: 0; }
        }`;
    document.body.appendChild(css);
};