(async () => {
    const {importAll, getScript} = await import(`https://rpgen3.github.io/mylib/export/import.mjs`);
    await Promise.all([
        'https://code.jquery.com/jquery-3.3.1.min.js',
        'https://colxi.info/midi-parser-js/src/main.js'
    ].map(getScript));
    const {$, MidiParser} = window;
    const rpgen3 = await importAll([
        'input'
    ].map(v => `https://rpgen3.github.io/mylib/export/${v}.mjs`));
    const addBtn = (h, ttl, func) => $('<button>').appendTo(h).text(ttl).on('click', func);
    const html = $('body').empty().css({
        'text-align': 'center',
        padding: '1em',
        'user-select': 'none'
    });
    const head = $('<dl>').appendTo(html),
          body = $('<dl>').appendTo(html).hide(),
          foot = $('<dl>').appendTo(html).hide();
    const msg = (() => {
        const elm = $('<div>').appendTo(body);
        return (str, isError) => $('<span>').appendTo(elm.empty()).text(str).css({
            color: isError ? 'red' : 'blue',
            backgroundColor: isError ? 'pink' : 'lightblue'
        });
    })();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
          dialog = async str => (msg(str), sleep(30));
    $('<div>').appendTo(head).text('MIDIファイルのゴミを掃除する');
    let g_midi = null;
    MidiParser.parse($('<input>').appendTo(head).prop({
        type: 'file',
        accept: '.mid'
    }).get(0), result => {
        g_midi = result;
        msg('MIDIファイルを読み込んだ');
        body.show();
    });
    $('<div>').appendTo(body).text('諸々の調整');
    const inputThreshold = rpgen3.addInputNum(body,{
        label: 'δ時間の閾値',
        save: true
    });
    addBtn(body, 'MIDIデータからBPMを取得する', () => {
        const {track} = g_midi;
        let bpm = 0;
        for(const {event} of track) {
            for(const v of event) {
                if(v.type !== 255 || v.metaType !== 81) continue;
                bpm = 60000000 / v.data;
                break;
            }
            if(bpm) break;
        }
        if(bpm) {
            inputBPM(bpm);
            msg('BPMを取得できた');
        }
        else msg('BPMを取得できなかった');
    });
    const inputBPM = (() => {
        const bpmMin = 40,
              bpmMax = 300;
        const inputBPM = rpgen3.addInputNum(body,{
            label: 'BPM',
            save: true,
            value: 140,
            min: bpmMin,
            max: bpmMax
        });
        let calcBPM = new class {
            constructor(){
                this.old = 0;
                this.ar = [];
            }
            main(){
                const now = performance.now(),
                      bpm = 1 / (now - this.old) * 1000 * 60;
                this.old = now;
                if(bpm < bpmMin || bpm > bpmMax) return;
                this.ar.push(bpm);
                inputBPM(this.ar.reduce((p,x) => p + x) / this.ar.length);
            }
        };
        addBtn(body, 'タップでBPM計測', () => calcBPM.main());
        addBtn(body, '計測リセット', () => {
            calcBPM = new calcBPM.constructor();
        });
        return inputBPM;
    })();
    addBtn(body, '処理開始', () => main());
    const main = async data => {
        cleanMIDI();
    };
    const cleanMIDI = () => {
        const {formatType, tracks, track} = g_midi;
        if(tracks !== 1) throw `MIDI tracks is ${formatType}.`;
        if(formatType !== 1) throw `MIDI formatType is ${formatType}.`;
        const vector = [],
              now = new Map,
              arrMap = new Map;
        let currentTime = 0;
        for(const {event} of track[0]) { // 全noteを回収
            const {deltaTime, type, data} = event;
            currentTime += deltaTime;
            if(type === 8 || type === 9) {
                const [note, velocity] = data,
                      isNoteOFF = type === 8 || !velocity;
                if(!arrMap.has(note)) arrMap.set(note, []);
                const arr = arrMap.get(note);
                if(now.has(note) && isNoteOFF) {
                    const node = now.get(note),
                          {start} = node;
                    node.end = currentTime;
                    now.delete(note);
                }
                else if(!isNoteOFF) {
                    const node = new Node(note, velocity, currentTime);
                    now.set(note, node);
                    arr.push(node);
                    vector.push(node);
                }
            }
        }
        for(const arr of arrMap) { // 細切れをくっつける
            let last = arr[0];
            for(let i = 1; i < arr.length; i++) {
                const now = arr[i];
                if(now.start - last.end < inputThreshold()) {
                    last.end = now.end;
                    now.muted = true;
                }
                else last = now;
            }
        }
        for(const node of vector) { // 閾値未満の音を消す
            const {start, end} = node;
            if(start - end < inputThreshold()) node.muted = true;
        }
        return vector.filter(({muted}) => !muted);
    };
    class Node {
        constructor(note, velocity, start){
            this.note = note;
            this.velocity = velocity;
            this.start = start;
            this.end = -1;
            this.muted = false;
        }
    }
    const output = () => {
    };
})();
