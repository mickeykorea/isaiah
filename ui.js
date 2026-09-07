// Typewriter effect for the headline prompt (styles live in style.css)
class TxtType {
    constructor(el, toRotate, period) {
        this.el = el;
        this.toRotate = toRotate;
        this.period = parseInt(period, 10) || 1000;
        this.txt = '';
        this.el.innerHTML = '<span class="wrap"><span class="cursor">●</span></span>';
        setTimeout(() => this.tick(), 1500);
    }

    tick() {
        const fullTxt = this.toRotate[0];
        this.txt = fullTxt.substring(0, this.txt.length + 1);
        this.el.innerHTML = `<span class="wrap">${this.txt}<span class="cursor">●</span></span>`;

        if (this.txt === fullTxt) {
            // Done typing: hide the cursor shortly after
            setTimeout(() => {
                this.el.innerHTML = `<span class="wrap">${this.txt}<span class="cursor-static">●</span></span>`;
            }, 500);
            return;
        }
        setTimeout(() => this.tick(), 50 - Math.random() * 25);
    }
}

window.addEventListener('load', () => {
    for (const el of document.getElementsByClassName('typewrite')) {
        const toRotate = el.getAttribute('data-type');
        if (toRotate) new TxtType(el, JSON.parse(toRotate), el.getAttribute('data-period'));
    }
});
