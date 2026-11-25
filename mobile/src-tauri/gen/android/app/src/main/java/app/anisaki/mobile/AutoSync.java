package app.anisaki.mobile;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.LongBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * Automatic subtitle sync, the same way as the PC player (src/renderer/src/lib/autosync.ts):
 * 1. the last few minutes of sound the player played (AudioTap, 16 kHz mono),
 * 2. Silero VAD (small speech detector, any language) marks where people talk,
 * 3. the subtitle lines are slid over that speech map; the shift where line starts best meet speech wins.
 * Runs on a worker thread.
 */
final class AutoSync {
    static final int RATE = 16000;
    static final int FRAME = 512; // samples per Silero frame = 32 ms
    static final double FRAME_SEC = FRAME / (double) RATE;

    static final class Result {
        double shift, confidence, gain, score, z;
        int cues;
        /** One clear shift wins and the lines meet speech there (PC: checkSub) */
        boolean fits() { return (confidence >= 0.35 && score >= 0.12) || (score >= 0.2 && z >= 4); }
        /** Worth moving the subtitles to (PC: runAutoSync) */
        boolean usable() { return confidence >= 0.35 && !(Math.abs(shift) >= 0.2 && gain < 0.05); }
    }

    private static byte[] model;

    /** Speech probability (0..1) for every 32 ms frame. */
    static float[] speech(Context c, float[] pcm) throws Exception {
        if (model == null) {
            try (InputStream in = c.getAssets().open("silero_vad_v5.onnx"); ByteArrayOutputStream b = new ByteArrayOutputStream()) {
                byte[] buf = new byte[65536];
                int r;
                while ((r = in.read(buf)) > 0) b.write(buf, 0, r);
                model = b.toByteArray();
            }
        }
        OrtEnvironment env = OrtEnvironment.getEnvironment();
        try (OrtSession.SessionOptions o = new OrtSession.SessionOptions()) {
            o.setIntraOpNumThreads(1);
            try (OrtSession s = env.createSession(model, o);
                 OnnxTensor sr = OnnxTensor.createTensor(env, LongBuffer.wrap(new long[] { RATE }), new long[0])) {
                int frames = pcm.length / FRAME;
                float[] out = new float[frames];
                float[][][] state = new float[2][1][128];
                float[] ctx = new float[64];
                for (int f = 0; f < frames; f++) {
                    float[] input = new float[64 + FRAME];
                    System.arraycopy(ctx, 0, input, 0, 64);
                    System.arraycopy(pcm, f * FRAME, input, 64, FRAME);
                    System.arraycopy(pcm, f * FRAME + FRAME - 64, ctx, 0, 64);
                    Map<String, OnnxTensor> in = new HashMap<>();
                    try (OnnxTensor x = OnnxTensor.createTensor(env, new float[][] { input });
                         OnnxTensor st = OnnxTensor.createTensor(env, state)) {
                        in.put("input", x);
                        in.put("state", st);
                        in.put("sr", sr);
                        try (OrtSession.Result r = s.run(in)) {
                            out[f] = ((float[][]) r.get("output").get().getValue())[0][0];
                            state = (float[][][]) r.get("stateN").get().getValue();
                        }
                    }
                }
                return out;
            }
        }
    }

    /**
     * Score every shift in ±range around the current delay (PC: align in autosync.ts).
     * + speech in the first 70 % of each line, − speech in the 0.4 s before it, − speech outside lines.
     */
    static Result align(float[] speech, double from, List<double[]> cues, double delay, double range) throws Exception {
        int n = speech.length;
        List<double[]> local = new ArrayList<>();
        for (double[] c : cues) if (c[1] + delay > from - range && c[0] + delay < from + n * FRAME_SEC + range) local.add(c);
        if (local.size() < 8) throw new Exception("Bu kısımda eşleştirmeye yetecek kadar altyazı satırı yok; konuşmanın bol olduğu bir yerde tekrar dene.");
        double[] prefix = new double[n + 1];
        for (int i = 0; i < n; i++) prefix[i + 1] = prefix[i] + speech[i];
        int pre = (int) Math.round(0.4 / FRAME_SEC), maxK = (int) Math.round(range / FRAME_SEC);
        double[] scores = new double[maxK * 2 + 1];
        Arrays.fill(scores, Double.NEGATIVE_INFINITY);
        for (int k = -maxK; k <= maxK; k++) {
            double shift = delay + k * FRAME_SEC;
            double inside = 0, len = 0, before = 0, beforeLen = 0, covered = 0, coveredLen = 0;
            for (double[] c : local) {
                int a = (int) Math.floor((c[0] + shift - from) / FRAME_SEC);
                int e = (int) Math.ceil((c[1] + shift - from) / FRAME_SEC);
                int core = a + Math.max(1, (int) Math.round((e - a) * 0.7));
                int ca = Math.max(0, a), cb = Math.min(n, core);
                if (cb > ca) { inside += sum(prefix, n, ca, cb); len += cb - ca; }
                before += sum(prefix, n, a - pre, a);
                beforeLen += Math.max(0, Math.min(n, a) - Math.max(0, a - pre));
                covered += sum(prefix, n, a, e);
                coveredLen += Math.max(0, Math.min(n, e) - Math.max(0, a));
            }
            if (len < 60) continue;
            double outside = (prefix[n] - covered) / Math.max(1, n - coveredLen);
            scores[k + maxK] = inside / len - 0.5 * (beforeLen > 0 ? before / beforeLen : 0) - 0.5 * outside;
        }
        int best = maxK;
        for (int i = 0; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
        if (Double.isInfinite(scores[best])) throw new Exception("Altyazı satırları bu kısımla örtüşmüyor.");
        int away = (int) Math.round(1.5 / FRAME_SEC);
        double second = Double.NEGATIVE_INFINITY;
        List<Double> finite = new ArrayList<>();
        for (int i = 0; i < scores.length; i++) {
            if (Double.isInfinite(scores[i])) continue;
            finite.add(scores[i]);
            if (Math.abs(i - best) > away && scores[i] > second) second = scores[i];
        }
        java.util.Collections.sort(finite);
        double median = finite.get(finite.size() / 2), peak = scores[best];
        Result r = new Result();
        r.confidence = peak > median ? Math.max(0, Math.min(1, (peak - Math.max(second, median)) / (peak - median))) : 0;
        double mean = 0;
        for (double v : finite) mean += v;
        mean /= finite.size();
        double sd = 0;
        for (double v : finite) sd += (v - mean) * (v - mean);
        sd = Math.sqrt(sd / finite.size());
        if (sd == 0) sd = 1e-9;
        r.z = (peak - mean) / sd;
        double atZero = scores[maxK];
        r.gain = Double.isInfinite(atZero) ? peak : peak - atZero;
        r.score = peak;
        r.cues = local.size();
        r.shift = Math.round((best - maxK) * FRAME_SEC * 100) / 100.0;
        return r;
    }

    private static double sum(double[] prefix, int n, int a, int b) {
        a = Math.max(0, Math.min(n, a));
        b = Math.max(0, Math.min(n, b));
        return b > a ? prefix[b] - prefix[a] : 0;
    }
}
