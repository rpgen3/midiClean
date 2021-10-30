(async () => {
    const {importAll, getScript} = await import(`https://rpgen3.github.io/mylib/export/import.mjs`);
    await Promise.all([
        'https://code.jquery.com/jquery-3.3.1.min.js',
        'https://colxi.info/midi-parser-js/src/main.js'
    ].map(getScript));
    const {$, MidiParser} = window;
    const rpgen3 = await importAll([
        'input',
        'util'
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
    const piano = (()=>{
        const semiTone = Math.exp(1/12 * Math.log(2)),
              hz = [...new Array(87)].reduce((p, x) => ([p[0] * semiTone].concat(p)), [27.5]).reverse(),
              ar = [],
              ptn = 'AABCCDDEFFGG',
              idxs = ptn.split('').map(v => ptn.indexOf(v));
        for(const i of hz.keys()){
            const j = i % ptn.length;
            ar.push(ptn[j] + (idxs.includes(j) ? '' : '#') + ((i + 9) / ptn.length | 0));
        }
        return {hz, hzToNote: ar};
    })();
    $('<div>').appendTo(head).text('MIDIファイルを読み込む');
    let g_midi = null;
    MidiParser.parse($('<input>').appendTo(head).prop({
        type: 'file',
        accept: '.mid'
    }).get(0), result => {
        g_midi = result;
        msg('MIDIファイルを読み込んだ');
        body.show();
        addSelectTracks();
    });
    $('<div>').appendTo(body).text('諸々の調整');
    const inputMinTone = rpgen3.addInputNum(body,{
        label: '下限の音階',
        save: true,
        value: 10,
        max: piano.hz.length,
        min: 0
    });
    const inputDiff = rpgen3.addInputNum(body,{
        label: 'setTimeoutの誤差を引く[ms]',
        save: true,
        value: 30,
        max: 500,
        min: 0
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
    const hChecks = $('<div>').appendTo(body);
    const selectTracks = [];
    const addSelectTracks = () => {
        const {track} = g_midi;
        hChecks.empty();
        while(selectTracks.length) selectTracks.pop();
        for(const [i, {event}] of track.entries()) selectTracks.push(rpgen3.addInputBool(hChecks,{
            label: `チャンネル${i}　トラック数：${event.length}`,
            value: true
        }));
    };
    addBtn(body, '処理開始', () => main());
    const main = async () => {
        const events = joinWait(trim(makeMusic()));
        await dialog(`イベントの数：${events.length}`);
        makeCode(events);
    };
    const makeMusic = () => {
        const {track} = g_midi,
              currentIndexs = [...new Array(track.length).fill(0)],
              totalTimes = currentIndexs.slice(),
              _indexs = selectTracks.flatMap((v, i) => v() ? [i] : []),
              result = [];
        let currentTime = 0;
        const getMin = () => {
            let min = Infinity,
                idx = 0;
            for(const index of _indexs) {
                const {event} = track[index],
                      {deltaTime} = event[currentIndexs[index]],
                      total = deltaTime + totalTimes[index];
                if(total > min) continue;
                min = total;
                idx = index;
            }
            return idx;
        };
        while(_indexs.length){
            const index = getMin(),
                  {event} = track[index],
                  {deltaTime, type, data} = event[currentIndexs[index]];
            totalTimes[index] += deltaTime;
            if(deltaTime) {
                const total = totalTimes[index],
                      time = total - currentTime,
                      i = result.length - 1;
                if(isNaN(result[i])) result.push(time);
                else result[i] += time;
                currentTime = total;
            }
            switch(type){
                case 8:
                case 9: {
                    const [note, velocity] = data,
                          isNoteOFF = type === 8 || !velocity;
                    if(isNoteOFF) break;
                    const tone = note - 21;
                    if(inputMinTone - 1 > tone) continue;
                    const id = getSoundId[tone];
                    if(id === void 0) continue;
                    result.push(playSound(id, 100 * velocity / 0x7F | 0));
                    break;
                }
            }
            if(++currentIndexs[index] >= event.length) _indexs.splice(_indexs.indexOf(index), 1);
        }
        return result;
    };
    const trim = arr => {
        let start = 0,
            end = arr.length;
        if(!isNaN(arr[0])) start++;
        if(!isNaN(arr[end - 1])) end--;
        return arr.slice(start, end);
    };
    const joinWait = arr => {
        const {timeDivision} = g_midi,
              deltaToMs = 1000 * 60 / inputBPM() / timeDivision,
              result = [];
        for(const v of arr){
            if(isNaN(v)) result.push(v);
            else {
                const time = v - inputDiff();
                if(time >= 0) result.push(wait(time * deltaToMs | 0));
            }
        }
        return result;
    };
    const playSound = (i, v) => `#PL_SD\ni:${i},v:${v},`,
          wait = t => `#WAIT\nt:${t},`;
    const getSoundId = (() => {
        const range = (start, end) => [...Array(end - start + 1).keys()].map(v => v + start);
        return [
            range(758, 821),
            range(1575, 1594),
            range(822, 825)
        ].flat();
    })();
    const rpgen = await importAll([
        'rpgen',
        'fullEvent'
    ].map(v => `https://rpgen3.github.io/midi/export/${v}.mjs`));
    const mapData = await(await fetch('data.txt')).text();
    const makeCode = events => rpgen3.addInputStr(foot.empty().show(),{
        value: rpgen.set(mapData.replace('$music$', `${startEvent}\n\n${new rpgen.FullEvent(10).make(events)}`.trim())),
        copy: true
    });
    const startEvent = new rpgen.FullEvent().make(['#CH_PH\np:0,x:0,y:0,'], 42, 3);
})();
