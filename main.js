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
    const main = () => download(outputMIDI(cleanMIDI()), 'midiClean.mid');
    const download = (url, ttl) => $('<a>').prop({
        href: url,
        download: ttl
    }).get(0).click();
    const cleanMIDI = () => {
        const {track} = g_midi,
              vector = [],
              now = new Map,
              arrMap = new Map;
        let currentTime = 0;
        for(const v of track[0].event) { // 全noteを回収
            const {deltaTime, type, data} = v;
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
    const outputMIDI = heap => {
        const {timeDivision} = g_midi,
              deltaToMs = 1000 * 60 / inputBPM() / timeDivision;
        let track = midi.addTrack();
        for(const node of nodes) {
            const {note, velocity, start, end} = node,
                  [_start, _end] = [start, end].map(v => v * deltaToMs);
            track.addNote({
                midi: note,
                time: _start,
                velocity: velocity / 0x7F,
                duration: _start - _end
            });
        }
        const arr = [];
        HeaderChunks(arr);
        TrackChunks(arr, heap);
        return URL.createObjectURL(new Blob(new Uint8Array(arr), {type: 'audio/midi'}));
    };
    const to2byte = n => [(n & 0xff00) >> 8, n & 0xff],
          to3byte = n => [(n & 0xff0000) >> 16, ...to2byte(n)];
    const HeaderChunks = arr => {
        arr.push(0x4D, 0x54, 0x68, 0x64); // チャンクタイプ(4byte)
        arr.push(0x00, 0x00, 0x00, 0x06); // データ長(4byte)
        const {formatType, tracks, timeDivision} = g_midi;
        for(const v of [
            formatType,
            tracks,
            timeDivision
        ]) arr.push(...to2byte(v));
    };
    const TrackChunks = (arr, heap) => {
        arr.push(0x4D, 0x54, 0x72, 0x6B); // チャンクタイプ(4byte)
        arr.push(0x00, 0x00, 0x00, 0x06); // データ長(4byte)
        arr.push(...DeltaTime(0));
        arr.push(0xFF, 0x51, 0x03, ...to3byte(60000000 / inputBPM)); // テンポ
        while(heap.length) {
            const {deltaTime, note, velocity} = heap.pop();
            arr.push(...DeltaTime(deltaTime));
            arr.push(0x90, note, velocity);
        }
        arr.push(...DeltaTime(0));
        arr.push(0xFF, 0x2F, 0x00); // トラックチャンクの終わりを示す
    };
    const DeltaTime = n => { // 可変長数値表現
        if(n === 0) return [0];
        const arr = [];
        let i = 0;
        while(n) {
            const _7bit = n & 0x7F;
            n >>= 7;
            arr.push(_7bit | (i++ ? 0x80 : 0));
        }
        return arr;
    };
})();
