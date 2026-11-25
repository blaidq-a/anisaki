package app.anisaki.mobile;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.ForwardingAudioSink;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Keeps the last ~3 minutes of the sound the player plays, as 16 kHz mono with its time (Nuvio's
 * "playback capture"): the automatic subtitle sync reads it, so nothing is downloaded or decoded again
 * (reading the video a second time was too slow for a torrent). Times are in the renderers' clock.
 */
final class AudioTap extends ForwardingAudioSink {
    static final int RATE = 16000;
    private static final int SIZE = RATE * 200;
    private final float[] ring = new float[SIZE];
    private long count;            // samples written since the last reset
    private long t0Us = C.TIME_UNSET; // clock time of sample 0
    private long lastPts = C.TIME_UNSET;
    private int rate, ch, enc;
    private boolean pcm;
    private int bin = -1;
    private double binSum;
    private int binN;

    AudioTap(AudioSink sink) { super(sink); }

    @Override public void configure(Format f, int bufferSize, int[] outputChannels) throws ConfigurationException {
        super.configure(f, bufferSize, outputChannels);
        synchronized (this) {
            pcm = MimeTypes.AUDIO_RAW.equals(f.sampleMimeType);
            rate = f.sampleRate;
            ch = Math.max(1, f.channelCount);
            enc = f.pcmEncoding;
            restart();
        }
    }

    @Override public void flush() {
        super.flush();
        synchronized (this) { restart(); }
    }

    private void restart() {
        count = 0;
        t0Us = C.TIME_UNSET;
        lastPts = C.TIME_UNSET;
        bin = -1;
        binN = 0;
        binSum = 0;
    }

    @Override public boolean handleBuffer(ByteBuffer buffer, long pts, int units) throws InitializationException, WriteException {
        // the sink is handed the same buffer again until it takes all of it: read each one once
        if (pcm && pts != lastPts && rate > 0) {
            lastPts = pts;
            try { capture(buffer.duplicate().order(ByteOrder.nativeOrder()), pts); } catch (RuntimeException ignored) {}
        }
        return super.handleBuffer(buffer, pts, units);
    }

    private synchronized void capture(ByteBuffer b, long pts) {
        int bytes = enc == C.ENCODING_PCM_FLOAT || enc == C.ENCODING_PCM_32BIT ? 4 : enc == C.ENCODING_PCM_24BIT ? 3 : enc == C.ENCODING_PCM_8BIT ? 1 : 2;
        int start = b.position(), frames = b.remaining() / (bytes * ch);
        if (t0Us == C.TIME_UNSET) t0Us = pts;
        long first = (pts - t0Us) * RATE / 1_000_000L;
        // a jump (seek without flush, gap): start over from here
        if (first < count - RATE || first > count + RATE) { restart(); t0Us = pts; first = 0; }
        for (int f = 0; f < frames; f++) {
            double v = 0;
            for (int c = 0; c < ch; c++) {
                int at = start + (f * ch + c) * bytes;
                if (enc == C.ENCODING_PCM_FLOAT) v += b.getFloat(at);
                else if (bytes == 2) v += b.getShort(at) / 32768.0;
                else if (bytes == 4) v += b.getInt(at) / 2147483648.0;
                else if (bytes == 1) v += ((b.get(at) & 0xFF) - 128) / 128.0;
                else v += ((b.get(at + 2) << 16) | ((b.get(at + 1) & 0xFF) << 8) | (b.get(at) & 0xFF)) / 8388608.0;
            }
            int k = (int) (first + (long) f * RATE / rate);
            if (k != bin) {
                if (bin >= 0 && binN > 0) put(bin, (float) (binSum / binN));
                bin = k;
                binSum = 0;
                binN = 0;
            }
            binSum += v / ch;
            binN++;
        }
    }

    private void put(int k, float v) {
        while (count < k) { ring[(int) (count % SIZE)] = v; count++; } // fill a tiny gap
        if (k == count) { ring[(int) (count % SIZE)] = v; count++; }
    }

    /** Seconds of sound kept now */
    synchronized double seconds() { return Math.min(count, SIZE) / (double) RATE; }

    /** The last `seconds` of sound (or less) and the clock time where it starts; null if under `min` s. */
    synchronized Object[] last(double seconds, double min) {
        long have = Math.min(count, SIZE);
        if (have < min * RATE || t0Us == C.TIME_UNSET) return null;
        int n = (int) Math.min(have, (long) (seconds * RATE));
        float[] out = new float[n];
        long from = count - n;
        for (int i = 0; i < n; i++) out[i] = ring[(int) ((from + i) % SIZE)];
        return new Object[] { t0Us + from * 1_000_000L / RATE, out };
    }
}
