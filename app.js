// ==========================================
// SITAR TUNER
// Custom 7-string tuning
// ==========================================


// ==========================================
// SITAR STRING DATA
// ==========================================

const strings = [

    {
        name: "String 1",
        swara: "Ma",
        note: "G",
        description: "Ma — G",
        frequency: 194
    },

    {
        name: "String 2",
        swara: "Sa",
        note: "D",
        description: "Sa — D",
        frequency: 145
    },

    {
        name: "String 3",
        swara: "Pa",
        note: "Lower A",
        description: "Pa — Lower A",
        frequency: 109
    },

    {
        name: "String 4",
        swara: "Sa",
        note: "Lower D",
        description: "Sa — Lower D",
        frequency: 72
    },

    {
        name: "Chikari 1",
        swara: "Pa",
        note: "Higher A",
        description: "Pa — Higher A",
        frequency: 218
    },

    {
        name: "Chikari 2",
        swara: "Sa",
        note: "D",
        description: "Sa — D",
        frequency: 290
    },

    {
        name: "Chikari 3",
        swara: "Sa",
        note: "Higher D",
        description: "Sa — Higher D",
        frequency: 580
    }

];


// ==========================================
// HTML ELEMENTS
// ==========================================

const stringSelect =
    document.getElementById("stringSelect");

const stringName =
    document.getElementById("stringName");

const swara =
    document.getElementById("swara");

const note =
    document.getElementById("note");

const targetFrequency =
    document.getElementById("targetFrequency");

const detectedFrequency =
    document.getElementById("detectedFrequency");

const centsDisplay =
    document.getElementById("cents");

const needle =
    document.getElementById("needle");

const status =
    document.getElementById("status");

const startButton =
    document.getElementById("startButton");

const micStatus =
    document.getElementById("micStatus");


// ==========================================
// AUDIO VARIABLES
// ==========================================

let audioContext = null;

let analyser = null;

let microphone = null;

let microphoneStream = null;

let animationFrame = null;

let tunerRunning = false;


// ==========================================
// SETTINGS
// ==========================================

// Important for the lowest string.
// Your lowest target is 72 Hz.

const MIN_FREQUENCY = 55;

const MAX_FREQUENCY = 800;


// Larger FFT gives better low-frequency resolution.

const FFT_SIZE = 16384;


// Store recent readings for smoothing.

let frequencyHistory = [];

const HISTORY_SIZE = 7;


// ==========================================
// SELECTED STRING
// ==========================================

function getSelectedString() {

    const index =
        Number(stringSelect.value);

    return strings[index];

}


// ==========================================
// UPDATE TARGET DISPLAY
// ==========================================

function updateTargetDisplay() {

    const selected =
        getSelectedString();

    stringName.textContent =
        selected.name;

    swara.textContent =
        selected.swara;

    note.textContent =
        selected.note;

    targetFrequency.textContent =
        selected.frequency.toFixed(2);

}


// ==========================================
// STRING SELECT CHANGE
// ==========================================

stringSelect.addEventListener(
    "change",
    () => {

        updateTargetDisplay();

        // Clear old readings when changing strings.

        frequencyHistory = [];

        detectedFrequency.textContent =
            "--.--";

        centsDisplay.textContent =
            "0";

        needle.style.transform =
            "translateX(-50%) rotate(0deg)";

        status.textContent =
            "READY";

    }
);


// ==========================================
// RMS / VOLUME DETECTION
// ==========================================

function calculateRMS(buffer) {

    let sum = 0;

    for (let i = 0; i < buffer.length; i++) {

        sum +=
            buffer[i] * buffer[i];

    }

    return Math.sqrt(
        sum / buffer.length
    );

}


// ==========================================
// YIN PITCH DETECTOR
// ==========================================

function detectPitchYIN(
    buffer,
    sampleRate
) {

    const size =
        buffer.length;

    const rms =
        calculateRMS(buffer);


    // Ignore silence.

    if (rms < 0.006) {

        return null;

    }


    const halfSize =
        Math.floor(size / 2);


    const difference =
        new Float32Array(halfSize);

    const normalized =
        new Float32Array(halfSize);


    // --------------------------------------
    // DIFFERENCE FUNCTION
    // --------------------------------------

    for (
        let tau = 1;
        tau < halfSize;
        tau++
    ) {

        let sum = 0;

        const limit =
            halfSize;


        for (
            let i = 0;
            i < limit;
            i++
        ) {

            const delta =
                buffer[i] -
                buffer[i + tau];

            sum +=
                delta * delta;

        }

        difference[tau] =
            sum;

    }


    // --------------------------------------
    // CUMULATIVE MEAN NORMALIZED DIFFERENCE
    // --------------------------------------

    normalized[0] = 1;

    let runningSum = 0;


    for (
        let tau = 1;
        tau < halfSize;
        tau++
    ) {

        runningSum +=
            difference[tau];


        if (runningSum === 0) {

            normalized[tau] = 1;

        } else {

            normalized[tau] =
                difference[tau] *
                tau /
                runningSum;

        }

    }


    // --------------------------------------
    // SEARCH RANGE
    // --------------------------------------

    const minTau =
        Math.floor(
            sampleRate /
            MAX_FREQUENCY
        );

    const maxTau =
        Math.min(

            Math.floor(
                sampleRate /
                MIN_FREQUENCY
            ),

            halfSize - 2

        );


    // --------------------------------------
    // FIND YIN DIP
    // --------------------------------------

    const threshold = 0.15;

    let tauEstimate = -1;

    let bestValue = Infinity;


    for (
        let tau = Math.max(2, minTau);
        tau < maxTau;
        tau++
    ) {

        if (
            normalized[tau] <
            threshold
        ) {

            while (
                tau + 1 < maxTau &&
                normalized[tau + 1] <
                normalized[tau]
            ) {

                tau++;

            }

            tauEstimate =
                tau;

            break;

        }


        // Keep best candidate as fallback.

        if (
            normalized[tau] <
            bestValue
        ) {

            bestValue =
                normalized[tau];

            tauEstimate =
                tau;

        }

    }


    if (
        tauEstimate < 2 ||
        tauEstimate >= maxTau
    ) {

        return null;

    }


    // --------------------------------------
    // PARABOLIC INTERPOLATION
    // --------------------------------------

    const previous =
        normalized[tauEstimate - 1];

    const current =
        normalized[tauEstimate];

    const next =
        normalized[tauEstimate + 1];


    const denominator =
        previous -
        2 * current +
        next;


    let betterTau =
        tauEstimate;


    if (
        denominator !== 0 &&
        Number.isFinite(denominator)
    ) {

        betterTau =
            tauEstimate +
            0.5 *
            (previous - next) /
            denominator;

    }


    // --------------------------------------
    // FREQUENCY
    // --------------------------------------

    const frequency =
        sampleRate /
        betterTau;


    if (
        !Number.isFinite(frequency) ||
        frequency < MIN_FREQUENCY ||
        frequency > MAX_FREQUENCY
    ) {

        return null;

    }


    // Lower normalized difference = better.

    const confidence =
        1 -
        normalized[tauEstimate];


    return {

        frequency: frequency,

        confidence: confidence

    };

}


// ==========================================
// OCTAVE / HARMONIC CORRECTION
// ==========================================
//
// Sitar has many strong harmonics.
//
// Sometimes the microphone can detect:
//
// 72 Hz as 144 Hz
// 109 Hz as 218 Hz
// 194 Hz as 97 Hz
//
// This function checks octave-related
// frequencies and chooses the one closest
// to the selected target.
//
// ==========================================

function adjustToTarget(
    rawFrequency,
    target
) {

    let bestFrequency =
        rawFrequency;

    let bestDistance =
        Math.abs(
            1200 *
            Math.log2(
                rawFrequency /
                target
            )
        );


    for (
        let k = -3;
        k <= 3;
        k++
    ) {

        const candidate =
            rawFrequency *
            Math.pow(2, k);


        if (
            candidate < 50 ||
            candidate > 900
        ) {

            continue;

        }


        const distance =
            Math.abs(

                1200 *
                Math.log2(
                    candidate /
                    target
                )

            );


        if (
            distance <
            bestDistance
        ) {

            bestDistance =
                distance;

            bestFrequency =
                candidate;

        }

    }


    // Don't force wildly incorrect notes
    // to become the target.

    if (
        bestDistance <= 300
    ) {

        return bestFrequency;

    }


    return rawFrequency;

}


// ==========================================
// MEDIAN FILTER
// ==========================================

function getMedian(values) {

    if (
        values.length === 0
    ) {

        return null;

    }


    const sorted =
        [...values].sort(
            (a, b) => a - b
        );


    const middle =
        Math.floor(
            sorted.length / 2
        );


    if (
        sorted.length % 2 === 0
    ) {

        return (
            sorted[middle - 1] +
            sorted[middle]
        ) / 2;

    }


    return sorted[middle];

}


// ==========================================
// CENTS CALCULATION
// ==========================================

function calculateCents(
    detected,
    target
) {

    return (
        1200 *
        Math.log2(
            detected /
            target
        )
    );

}


// ==========================================
// UPDATE NEEDLE
// ==========================================

function updateNeedle(cents) {

    // Keep the visible needle within
    // approximately -50 to +50 cents.

    const limitedCents =
        Math.max(
            -50,
            Math.min(50, cents)
        );


    const angle =
        (limitedCents / 50) * 45;


    needle.style.transform =
        `translateX(-50%) rotate(${angle}deg)`;

}


// ==========================================
// UPDATE STATUS
// ==========================================

function updateStatus(cents) {

    const absoluteCents =
        Math.abs(cents);


    if (
        absoluteCents <= 5
    ) {

        status.textContent =
            "✓ IN TUNE";

    }

    else if (
        cents < 0
    ) {

        status.textContent =
            "♭ TOO FLAT";

    }

    else {

        status.textContent =
            "♯ TOO SHARP";

    }

}


// ==========================================
// UPDATE TUNER DISPLAY
// ==========================================

function updateTuner(
    frequency
) {

    const selected =
        getSelectedString();


    const cents =
        calculateCents(
            frequency,
            selected.frequency
        );


    detectedFrequency.textContent =
        frequency.toFixed(2);


    centsDisplay.textContent =
        cents >= 0
            ? `+${cents.toFixed(1)}`
            : cents.toFixed(1);


    updateNeedle(cents);

    updateStatus(cents);

}


// ==========================================
// MAIN AUDIO PROCESSING
// ==========================================

function processAudio() {

    if (!tunerRunning) {

        return;

    }


    const buffer =
        new Float32Array(
            analyser.fftSize
        );


    analyser.getFloatTimeDomainData(
        buffer
    );


    const result =
        detectPitchYIN(
            buffer,
            audioContext.sampleRate
        );


    if (result !== null) {

        // Ignore very weak detections.

        if (
            result.confidence >= 0.65
        ) {

            const selected =
                getSelectedString();


            let frequency =
                result.frequency;


            // Correct octave/harmonic errors.

            frequency =
                adjustToTarget(
                    frequency,
                    selected.frequency
                );


            // Add reading to history.

            frequencyHistory.push(
                frequency
            );


            if (
                frequencyHistory.length >
                HISTORY_SIZE
            ) {

                frequencyHistory.shift();

            }


            // Median smoothing.

            const smoothFrequency =
                getMedian(
                    frequencyHistory
                );


            if (
                smoothFrequency !== null
            ) {

                updateTuner(
                    smoothFrequency
                );

            }

        }

    }


    animationFrame =
        requestAnimationFrame(
            processAudio
        );

}


// ==========================================
// START MICROPHONE
// ==========================================

async function startTuner() {

    try {

        micStatus.textContent =
            "Requesting microphone access...";


        microphoneStream =
            await navigator.mediaDevices
                .getUserMedia({

                    audio: {

                        echoCancellation: false,

                        noiseSuppression: false,

                        autoGainControl: false

                    }

                });


        // ----------------------------------
        // AUDIO CONTEXT
        // ----------------------------------

        audioContext =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();


        if (
            audioContext.state ===
            "suspended"
        ) {

            await audioContext.resume();

        }


        // ----------------------------------
        // ANALYSER
        // ----------------------------------

        analyser =
            audioContext.createAnalyser();


        analyser.fftSize =
            FFT_SIZE;


        analyser.smoothingTimeConstant =
            0;


        // ----------------------------------
        // MICROPHONE
        // ----------------------------------

        microphone =
            audioContext.createMediaStreamSource(
                microphoneStream
            );


        microphone.connect(
            analyser
        );


        // ----------------------------------
        // START
        // ----------------------------------

        tunerRunning =
            true;


        frequencyHistory =
            [];


        startButton.textContent =
            "⏹ STOP TUNER";


        micStatus.textContent =
            "🎤 Listening... Pluck the selected string";


        status.textContent =
            "LISTENING";


        processAudio();


    }

    catch (error) {

        console.error(error);


        micStatus.textContent =
            "Microphone access was denied.";


        status.textContent =
            "MICROPHONE ERROR";


        alert(
            "Please allow microphone access and try again."
        );

    }

}


// ==========================================
// STOP MICROPHONE
// ==========================================

function stopTuner() {

    tunerRunning =
        false;


    if (
        animationFrame !== null
    ) {

        cancelAnimationFrame(
            animationFrame
        );

        animationFrame =
            null;

    }


    if (
        microphoneStream
    ) {

        microphoneStream
            .getTracks()
            .forEach(
                track => track.stop()
            );

        microphoneStream =
            null;

    }


    if (
        audioContext
    ) {

        audioContext.close();

        audioContext =
            null;

    }


    microphone =
        null;

    analyser =
        null;


    frequencyHistory =
        [];


    detectedFrequency.textContent =
        "--.--";


    centsDisplay.textContent =
        "0";


    needle.style.transform =
        "translateX(-50%) rotate(0deg)";


    status.textContent =
        "READY";


    micStatus.textContent =
        "Microphone stopped";


    startButton.textContent =
        "🎤 START TUNER";

}


// ==========================================
// START / STOP BUTTON
// ==========================================

startButton.addEventListener(
    "click",
    () => {

        if (tunerRunning) {

            stopTuner();

        } else {

            startTuner();

        }

    }
);


// ==========================================
// INITIAL DISPLAY
// ==========================================

updateTargetDisplay();

// ==========================================
// PWA SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.warn("Service worker registration failed:", error);
        });
    });
}