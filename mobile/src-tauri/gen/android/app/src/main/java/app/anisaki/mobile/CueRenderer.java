package app.anisaki.mobile;

import android.os.Handler;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.text.Cue;
import androidx.media3.decoder.DecoderInputBuffer;
import androidx.media3.exoplayer.BaseRenderer;
import androidx.media3.exoplayer.FormatHolder;
import androidx.media3.exoplayer.RendererCapabilities;
import androidx.media3.extractor.text.CueDecoder;
import androidx.media3.extractor.text.CuesWithTiming;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Anisaki's subtitle renderer, in place of ExoPlayer's own. ExoPlayer hands a subtitle line over only at the
 * moment it shows, so the live Turkish translation always started late and the line was gone soon after its
 * Turkish appeared. This one reads the subtitle samples as soon as they are buffered (the player buffers
 * tens of seconds ahead), hands each upcoming line to {@link Listener#ahead} (translated before its time),
 * and shows the lines when their time comes through {@link Listener#show} (on the main thread).
 *
 * Every subtitle the player plays comes here as Media3's own cue samples (subtitles are parsed while the
 * file is read: DefaultMediaSourceFactory.experimentalParseSubtitlesDuringExtraction in PlayerActivity).
 */
final class CueRenderer extends BaseRenderer {
    interface Listener {
        /** A line found ahead of time (playback thread; times in this renderer's clock, see {@link #now}). */
        void ahead(CuesWithTiming c);
        /** The lines on screen now (main thread). */
        void show(List<Cue> cues);
    }

    private final Listener out;
    private final Handler ui;
    private final CueDecoder decoder = new CueDecoder();
    private final DecoderInputBuffer buf = new DecoderInputBuffer(DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_NORMAL);
    private final List<CuesWithTiming> all = new ArrayList<>(); // by start time
    private final Set<String> seen = new HashSet<>(); // a seek reads some samples again
    private boolean inputEnded;
    private List<Cue> shown = Collections.emptyList();
    /** Where playback is, in the clock the line times use. */
    volatile long now;
    /** Subtitle timing set by the viewer: positive = the lines come later (µs). */
    volatile long delayUs;

    CueRenderer(Listener out, Handler ui) {
        super(C.TRACK_TYPE_TEXT);
        this.out = out;
        this.ui = ui;
    }

    @Override public String getName() { return "AnisakiCues"; }

    @Override public int supportsFormat(Format f) {
        return MimeTypes.APPLICATION_MEDIA3_CUES.equals(f.sampleMimeType)
            ? RendererCapabilities.create(C.FORMAT_HANDLED)
            : RendererCapabilities.create(MimeTypes.isText(f.sampleMimeType) ? C.FORMAT_UNSUPPORTED_SUBTYPE : C.FORMAT_UNSUPPORTED_TYPE);
    }

    @Override public void render(long positionUs, long elapsedRealtimeUs) {
        now = positionUs;
        // everything buffered so far
        while (!inputEnded) {
            FormatHolder fh = getFormatHolder();
            fh.clear();
            buf.clear();
            int r = readSource(fh, buf, 0);
            if (r == C.RESULT_FORMAT_READ) continue;
            if (r != C.RESULT_BUFFER_READ) break;
            if (buf.isEndOfStream()) { inputEnded = true; break; }
            buf.flip();
            ByteBuffer d = buf.data;
            if (d == null) continue;
            byte[] b = new byte[d.remaining()];
            d.get(b);
            CuesWithTiming c;
            try {
                c = decoder.decode(buf.timeUs, b, 0, b.length);
            } catch (RuntimeException e) {
                continue;
            }
            if (!seen.add(c.startTimeUs + "|" + c.cues.size() + "|" + (c.cues.isEmpty() ? "" : String.valueOf(c.cues.get(0).text)))) continue;
            synchronized (all) {
                int at = all.size();
                while (at > 0 && all.get(at - 1).startTimeUs > c.startTimeUs) at--;
                all.add(at, c);
            }
            if (!c.cues.isEmpty()) out.ahead(c);
        }
        List<Cue> cur = current(positionUs - delayUs);
        if (!cur.equals(shown)) {
            shown = cur;
            final List<Cue> s = cur;
            ui.post(() -> out.show(s));
        }
    }

    /** The lines whose time it is (a line without a length lasts until the next one starts). */
    private List<Cue> current(long pos) {
        List<Cue> l = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) {
            CuesWithTiming c = all.get(i);
            if (c.startTimeUs > pos) break;
            long end = c.durationUs != C.TIME_UNSET ? c.startTimeUs + c.durationUs
                : i + 1 < all.size() ? all.get(i + 1).startTimeUs : c.startTimeUs + 5_000_000;
            if (pos < end) l.addAll(c.cues);
        }
        return l;
    }

    @Override protected void onPositionReset(long positionUs, boolean joining) {
        inputEnded = false;
        now = positionUs;
    }

    /** Every line read so far as [start, end] in seconds of the video (`offsetUs`: this clock − video time). */
    List<double[]> cueTimes(long offsetUs) {
        List<double[]> out = new ArrayList<>();
        synchronized (all) {
            for (int i = 0; i < all.size(); i++) {
                CuesWithTiming c = all.get(i);
                if (c.cues.isEmpty()) continue;
                long end = c.durationUs != C.TIME_UNSET ? c.startTimeUs + c.durationUs
                    : i + 1 < all.size() ? all.get(i + 1).startTimeUs : c.startTimeUs + 5_000_000;
                out.add(new double[] { (c.startTimeUs - offsetUs) / 1e6, (end - offsetUs) / 1e6 });
            }
        }
        return out;
    }

    @Override protected void onDisabled() {
        synchronized (all) { all.clear(); }
        seen.clear();
        inputEnded = false;
        shown = Collections.emptyList();
        ui.post(() -> out.show(Collections.emptyList()));
    }

    @Override public boolean isReady() { return true; }

    @Override public boolean isEnded() { return inputEnded; }
}
