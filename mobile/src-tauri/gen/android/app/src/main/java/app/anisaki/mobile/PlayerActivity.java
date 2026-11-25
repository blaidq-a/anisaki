package app.anisaki.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.KeyEvent;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Anisaki's in-app player (ExoPlayer + FFmpeg audio): own controls like the desktop player —
 * OP/ED marked on the bar with a skip button (or automatic skipping), previous / next episode,
 * speed, audio and subtitle tracks, other sources, aspect ratio, lock. On close it reports the
 * position, length and what the user asked for next ("next", "prev", "sources").
 */
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private View controls, lockOverlay;
    private ImageButton playBtn;
    private SeekBar seek;
    private SegmentBar segBar;
    private TextView posText, durText, qualityText, skipBtn, flash;
    // Töz live translation: the English (or unlabeled) subtitle in the file is translated line by line as it
    // shows; ExoPlayer's own subtitle view is hidden meanwhile and liveSub shows the Turkish line.
    private TextView liveSub;
    private boolean tozLive, tozAuto, tozTried;
    /** The viewer's subtitle languages (Ayarlar → Dil) as ISO 639-2 codes; English is always among them. */
    private final java.util.Set<String> subLangs = new java.util.HashSet<>();
    /** "Diğer diller" opened in the subtitle list */
    private boolean allSubs;

    private static String iso3(String l) {
        if (l == null || l.isEmpty() || l.equals("und")) return "";
        try {
            return Locale.forLanguageTag(l).getISO3Language();
        } catch (Exception e) {
            return l;
        }
    }
    private final java.util.concurrent.ExecutorService tozExec = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.Map<String, String> tozCache = new java.util.concurrent.ConcurrentHashMap<>(); // read by Töz's thread too
    private volatile String tozShown = "";
    // An English subtitle file from the internet is translated in the background as well (from where the
    // viewer is), so its lines are ready before they show and the bar can say how far it got.
    private String enFile, enLabel;
    private TextView tozState;
    private volatile int preDone, preTotal;
    private volatile boolean preRunning;
    private java.io.File tozDir;
    private static native String tozTranslate(String dir, String text);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private double[] segStart = new double[0], segEnd = new double[0];
    private String[] segKind = new String[0];
    private boolean autoSkipOp, autoSkipEd, autoNext, hasNext, hasPrev, locked, dragging;
    private final java.util.Set<Integer> skipped = new java.util.HashSet<>();
    private int aspect = 0;
    private String action = "";

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private static String time(long ms) {
        long s = Math.max(0, ms / 1000);
        return s >= 3600 ? String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String.format(Locale.US, "%d:%02d", s / 60, s % 60);
    }

    private ImageButton icon(int res, int size, View.OnClickListener l) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(res);
        b.setBackground(focusFrame());
        b.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        b.setPadding(dp(10), dp(10), dp(10), dp(10));
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(size), dp(size)));
        b.setOnClickListener(v -> { l.onClick(v); poke(); });
        return b;
    }

    /** Icon + label button of the bottom row */
    private LinearLayout action(int res, String label, View.OnClickListener l) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(6), dp(14), dp(6));
        android.widget.ImageView i = new android.widget.ImageView(this);
        i.setImageResource(res);
        row.addView(i, new LinearLayout.LayoutParams(dp(22), dp(22)));
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(Color.WHITE);
        t.setTextSize(14);
        t.setPadding(dp(8), 0, 0, 0);
        row.addView(t);
        row.setOnClickListener(v -> { l.onClick(v); poke(); });
        row.setFocusable(true);
        row.setBackground(focusFrame());
        return row;
    }

    /** Clear when idle, a light rounded frame when the remote's focus is on it (TV). */
    private android.graphics.drawable.StateListDrawable focusFrame() {
        android.graphics.drawable.StateListDrawable d = new android.graphics.drawable.StateListDrawable();
        GradientDrawable f = round(0x40FFFFFF, 12);
        f.setStroke(dp(2), Color.WHITE);
        d.addState(new int[] { android.R.attr.state_focused }, f);
        d.addState(new int[] {}, new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        return d;
    }

    /** Android TV (remote control instead of touch) */
    private boolean tv() {
        android.app.UiModeManager m = (android.app.UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        return (m != null && m.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION);
    }

    /**
     * TV remote. Controls hidden: OK plays / pauses, left / right seek 10 s, up / down bring the controls
     * up with the focus on Play. Controls shown: the arrows move between the buttons (and keep them up),
     * Back hides them first. Media keys (play/pause, rewind, fast-forward, next) work either way.
     */
    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        if (player == null || locked) return super.dispatchKeyEvent(e);
        int k = e.getKeyCode();
        if (epPanel != null) {
            if (k == KeyEvent.KEYCODE_BACK) { if (e.getAction() == KeyEvent.ACTION_UP) panelBack(); return true; }
            // the arrows stay inside the panel (held down they used to slip out to Play behind it)
            int dir = k == KeyEvent.KEYCODE_DPAD_UP ? View.FOCUS_UP : k == KeyEvent.KEYCODE_DPAD_DOWN ? View.FOCUS_DOWN
                : k == KeyEvent.KEYCODE_DPAD_LEFT ? View.FOCUS_LEFT : k == KeyEvent.KEYCODE_DPAD_RIGHT ? View.FOCUS_RIGHT : 0;
            if (dir != 0) {
                if (e.getAction() == KeyEvent.ACTION_DOWN) {
                    View cur = getCurrentFocus();
                    View next = cur != null && isInside(cur, epPanel) ? android.view.FocusFinder.getInstance().findNextFocus((ViewGroup) epPanel, cur, dir) : null;
                    if (next != null) next.requestFocus();
                    else if (cur == null || !isInside(cur, epPanel)) focusPanel(null);
                }
                return true;
            }
            return super.dispatchKeyEvent(e);
        }
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        switch (k) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_MEDIA_PLAY: case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (down && e.getRepeatCount() == 0) { if (player.isPlaying() && k != KeyEvent.KEYCODE_MEDIA_PLAY) player.pause(); else player.play(); poke(); }
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: if (down) seekBy(30000); return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND: if (down) seekBy(-10000); return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT: if (down && hasNext) goEp(1); return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: if (down && hasPrev) goEp(-1); return true;
        }
        boolean shown = controls.getVisibility() == View.VISIBLE;
        if (k == KeyEvent.KEYCODE_BACK && shown && down) { controls.setVisibility(View.GONE); subPos(); return true; }
        if (k == KeyEvent.KEYCODE_BACK && shown) return true;
        boolean dpad = k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_DPAD_LEFT
            || k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN;
        if (!dpad) return super.dispatchKeyEvent(e);
        if (!shown) {
            if (!down) return true;
            if (k == KeyEvent.KEYCODE_DPAD_LEFT) seekBy(-10000);
            else if (k == KeyEvent.KEYCODE_DPAD_RIGHT) seekBy(10000);
            else {
                if ((k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER) && e.getRepeatCount() == 0) {
                    if (player.isPlaying()) player.pause(); else player.play();
                }
                poke();
                playBtn.requestFocus();
            }
            return true;
        }
        poke();
        // nothing focused yet inside the controls: start on Play
        View f = getCurrentFocus();
        if (down && (f == null || !isInside(f, controls))) { playBtn.requestFocus(); return true; }
        return super.dispatchKeyEvent(e);
    }

    private static boolean isInside(View v, View parent) {
        for (android.view.ViewParent p = v.getParent(); p != null; p = p.getParent()) if (p == parent) return true;
        return v == parent;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // landscape (Android 8.0 refuses a fixed orientation for a translucent window: then it follows the phone)
        try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE); } catch (IllegalStateException e) { /* Android 8.0 */ }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // over the camera notch too (else the app behind showed through a strip at the side)
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams wl = getWindow().getAttributes();
            wl.layoutInDisplayCutoutMode = android.os.Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(wl);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ic.hide(WindowInsetsCompat.Type.systemBars());
        ic.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        current = this;
        Intent in = getIntent();

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        view.setUseController(false);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setKeepScreenOn(true);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));
        liveSub = new TextView(this);
        liveSub.setTextColor(Color.WHITE);
        liveSub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        liveSub.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        liveSub.setGravity(Gravity.CENTER);
        liveSub.setShadowLayer(6f, 0f, 0f, Color.BLACK);
        liveSub.setPadding(dp(8), dp(2), dp(8), dp(2));
        liveSub.setVisibility(View.GONE);
        FrameLayout.LayoutParams sl = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        sl.setMargins(dp(40), 0, dp(40), dp(28));
        root.addView(liveSub, sl);

        // Taps: one shows / hides the controls, two on the left / right side seek 10 s.
        View touch = new View(this);
        GestureDetector gd = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            // Must claim the touch, or the rest of the gesture (taps) never arrives.
            @Override public boolean onDown(MotionEvent e) { return true; }
            @Override public boolean onSingleTapConfirmed(MotionEvent e) {
                if (locked) { lockOverlay.setVisibility(lockOverlay.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE); return true; }
                if (controls.getVisibility() == View.VISIBLE) controls.setVisibility(View.GONE); else poke();
                return true;
            }
            @Override public boolean onDoubleTap(MotionEvent e) {
                if (locked) return true;
                boolean right = e.getX() > touch.getWidth() / 2f;
                seekBy(right ? 10000 : -10000);
                return true;
            }
        });
        touch.setOnTouchListener((v, e) -> gd.onTouchEvent(e));
        touch.setFocusable(false);
        view.setFocusable(false);
        root.addView(touch, new FrameLayout.LayoutParams(-1, -1));

        flash = new TextView(this);
        flash.setTextColor(Color.WHITE);
        flash.setTextSize(18);
        flash.setVisibility(View.GONE);
        flash.setPadding(dp(16), dp(8), dp(16), dp(8));
        flash.setBackground(round(0xAA000000, 12));
        root.addView(flash, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));

        controls = buildControls();
        root.addView(controls, new FrameLayout.LayoutParams(-1, -1));

        skipBtn = new TextView(this);
        skipBtn.setTextColor(Color.BLACK);
        skipBtn.setTextSize(15);
        skipBtn.setTypeface(null, android.graphics.Typeface.BOLD);
        skipBtn.setPadding(dp(18), dp(10), dp(18), dp(10));
        skipBtn.setBackground(round(0xFFFFFFFF, 12));
        skipBtn.setVisibility(View.GONE);
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END);
        sp.setMargins(0, 0, dp(28), dp(120));
        root.addView(skipBtn, sp);

        lockOverlay = icon(R.drawable.ic_lock, 52, v -> { locked = false; lockOverlay.setVisibility(View.GONE); poke(); });
        lockOverlay.setBackground(round(0x88000000, 26));
        lockOverlay.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.TOP | Gravity.END);
        lp.setMargins(0, dp(20), dp(28), 0);
        root.addView(lockOverlay, lp);
        loading = buildLoading();
        root.addView(loading, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // Phone decoders for video; the bundled FFmpeg handles audio formats phones get wrong (EAC3, DTS…).
        // subtitles go through Anisaki's own renderer (CueRenderer): it sees the lines before their time
        DefaultRenderersFactory rf = new DefaultRenderersFactory(this) {
            @Override protected void buildTextRenderers(Context c, androidx.media3.exoplayer.text.TextOutput o, Looper l, int mode, ArrayList<androidx.media3.exoplayer.Renderer> out) {
                cueRenderer = new CueRenderer(cueListener, ui);
                out.add(cueRenderer);
            }
            // the sound as it plays, for the automatic subtitle sync (AudioTap)
            @Override protected androidx.media3.exoplayer.audio.AudioSink buildAudioSink(Context c, boolean floatOut, boolean params) {
                androidx.media3.exoplayer.audio.AudioSink s = super.buildAudioSink(c, floatOut, params);
                return s == null ? null : (audioTap = new AudioTap(s));
            }
        }.setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
        // The Android emulator's video decoder fails on real files: there the software decoder goes first.
        if (android.os.Build.HARDWARE.contains("ranchu") || android.os.Build.HARDWARE.contains("goldfish")) {
            rf.setMediaCodecSelector((mime, secure, tunneling) -> {
                List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> l = new ArrayList<>(androidx.media3.exoplayer.mediacodec.MediaCodecUtil.getDecoderInfos(mime, secure, tunneling));
                java.util.Collections.sort(l, (x, y) -> Boolean.compare(!x.name.startsWith("c2.android"), !y.name.startsWith("c2.android")));
                return l;
            });
        }
        // A torrent's first pieces can take a while to arrive (peers still being found): the default 8 s
        // read timeout gave up on them. One player serves every episode, so the long limit is kept for all.
        androidx.media3.datasource.DefaultHttpDataSource.Factory http = new androidx.media3.datasource.DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(30000)
            .setReadTimeoutMs(150000)
            .setAllowCrossProtocolRedirects(true);
        player = new ExoPlayer.Builder(this, rf)
            .setMediaSourceFactory(new androidx.media3.exoplayer.source.DefaultMediaSourceFactory(new androidx.media3.datasource.DefaultDataSource.Factory(this, http))
                .experimentalParseSubtitlesDuringExtraction(true))
            .build();
        view.setPlayer(player);
        applySubStyle();

        player.addListener(new Player.Listener() {
            @Override public void onTracksChanged(Tracks t) {
                // Ayarlar: Töz on and no Turkish subtitle was prepared → translate the file's English live
                if (!tozAuto || tozTried) return;
                // a new item reports its tracks in steps (first none): decide once the subtitles are known
                boolean anyText = false;
                for (Tracks.Group g : t.getGroups()) if (g.getType() == C.TRACK_TYPE_TEXT) anyText = true;
                if (!anyText) return;
                tozTried = true;
                for (Tracks.Group g : t.getGroups()) if (g.getType() == C.TRACK_TYPE_TEXT) for (int i = 0; i < g.length; i++) {
                    String l = g.getTrackFormat(i).language;
                    if (l != null && (l.startsWith("tr") || l.equals("tur"))) return;
                }
                // the video's own English first: its timing fits this exact file (a downloaded one may be
                // from another release, out of sync, even another episode)
                int[] ai = aiTrack(t);
                if (ai != null) startToz(t.getGroups().get(ai[0]).getMediaTrackGroup(), ai[1]);
            }
            @Override public void onIsPlayingChanged(boolean playing) {
                playBtn.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
                if (pausedMark != null) pausedMark.setVisibility(playing ? View.GONE : View.VISIBLE);
            }
            @Override public void onPlaybackStateChanged(int s) {
                if (s == Player.STATE_ENDED) {
                    // the next episode opens in this same player (it was prepared near the end)
                    if (autoNext && hasNext) goEp(1);
                    else finishWithResult();
                }
            }
            @Override public void onVideoSizeChanged(androidx.media3.common.VideoSize vs) {
                int h = Math.min(vs.height, vs.width);
                String q = h >= 2000 ? "4K" : h >= 1400 ? "2K" : h >= 1000 ? "FHD" : h >= 700 ? "HD" : h > 0 ? "SD" : "";
                qualityText.setText(q);
                qualityText.setVisibility(q.isEmpty() ? View.GONE : View.VISIBLE);
            }
            @Override public void onPlayerError(PlaybackException error) {
                showFlash("Video oynatılamadı (" + error.getErrorCodeName() + "). Kaynaklar'dan başka bir kaynak seç ya da Ayarlar'dan harici oynatıcıyı dene.", 8000);
            }
        });
        // Opened while the app still looks for a source: the waiting screen (already landscape, Back cancels);
        // the video comes with "load", which may even have arrived before this screen was up.
        if (in.getStringExtra("url") == null) {
            status(in.getStringExtra("title"), in.getStringExtra("subtitle"), in.getStringExtra("message") != null ? in.getStringExtra("message") : "Kaynak aranıyor…");
            Intent p = pending;
            pending = null;
            if (p != null) startMedia(p);
        } else startMedia(in);
        ui.post(tick);
    }

    /* ---------------- one player for the whole session: episodes and sources load into it ---------------- */
    static PlayerActivity current;
    /** Set before the player starts (PlayerPlugin.play), cleared when it closes: the app page keeps running. */
    static volatile boolean keepPage;
    /** A video sent ("load") before the player had finished opening. */
    static volatile Intent pending;
    /** To the app (Rust emits it to the page): "player:episode", "player:goto", "player:progress"… */
    private static native void toApp(String ch, String json);
    private void send(String ch, String json) {
        try { toApp(ch, json); } catch (Throwable e) { /* the app is gone */ }
    }

    private FrameLayout loading;
    private TextView loadTitle, loadSub, loadMsg, t1, t2;
    private View prevBtn, nextBtn, epsBtn;
    private View pausedMark; // TV: the big pause sign in the middle while stopped
    private int episode;
    private int[] epNums = new int[0];
    private String[] epTitles = new String[0];
    /** Labels of the subtitles the app added (downloaded); the rest are the video's own. */
    private final java.util.Set<String> addedLabels = new java.util.HashSet<>();
    private String[] epImages = new String[0];
    private boolean[] epFillers = new boolean[0];
    private FrameLayout rootView;
    private View epPanel; // the episode list sliding in from the right
    private final java.util.Map<String, android.graphics.Bitmap> thumbs = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.ExecutorService thumbExec = java.util.concurrent.Executors.newFixedThreadPool(3);
    private boolean prefetchSent;

    private FrameLayout buildLoading() {
        FrameLayout f = new FrameLayout(this);
        f.setBackgroundColor(Color.BLACK);
        f.setClickable(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        loadTitle = new TextView(this);
        loadTitle.setTextColor(Color.WHITE);
        loadTitle.setTextSize(24);
        loadTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        loadTitle.setGravity(Gravity.CENTER);
        loadSub = new TextView(this);
        loadSub.setTextColor(0xCCFFFFFF);
        loadSub.setTextSize(15);
        loadSub.setGravity(Gravity.CENTER);
        android.widget.ProgressBar pb = new android.widget.ProgressBar(this);
        pb.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        loadMsg = new TextView(this);
        loadMsg.setTextColor(0xCCFFFFFF);
        loadMsg.setTextSize(14);
        loadMsg.setGravity(Gravity.CENTER);
        col.addView(loadTitle);
        col.addView(loadSub);
        LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(dp(36), dp(36));
        pl.setMargins(0, dp(18), 0, dp(8));
        col.addView(pb, pl);
        col.addView(loadMsg);
        f.addView(col, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));
        View x = icon(R.drawable.ic_back, 48, v -> finishWithResult());
        if (tv()) x.setVisibility(View.GONE); // the remote's Back key does this
        FrameLayout.LayoutParams xl = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.START);
        xl.setMargins(dp(12), dp(10), 0, 0);
        f.addView(x, xl);
        f.setVisibility(View.GONE);
        return f;
    }

    /** The waiting screen between episodes / sources (landscape, inside the player). */
    void status(String title, String sub, String msg) {
        if (title != null) loadTitle.setText(title);
        if (sub != null) loadSub.setText(sub);
        loadMsg.setText(msg != null ? msg : "Yükleniyor…");
        loading.setVisibility(View.VISIBLE);
        controls.setVisibility(View.GONE);
    }

    /** A new episode or source: same player, new video, subtitles and OP/ED times. */
    void startMedia(Intent in) {
        String url = in.getStringExtra("url");
        mediaUrl = url;
        // Ayarlar → Dil ve altyazı → "Altyazıyı sesle otomatik eşitle" (on unless turned off)
        autoSyncDone = !in.getBooleanExtra("autoSync", true);
        syncTried.clear();
        String title = in.getStringExtra("title");
        String subtitle = in.getStringExtra("subtitle");
        long position = in.getLongExtra("position", 0);
        autoSkipOp = in.getBooleanExtra("autoSkipOp", false);
        autoSkipEd = in.getBooleanExtra("autoSkipEd", false);
        autoNext = in.getBooleanExtra("autoNext", true);
        tozAuto = in.getBooleanExtra("tozAuto", false);
        hasNext = in.getBooleanExtra("hasNext", false);
        hasPrev = in.getBooleanExtra("hasPrev", false);
        episode = in.getIntExtra("episode", 0);
        if (in.getIntArrayExtra("epNums") != null) {
            epNums = in.getIntArrayExtra("epNums");
            epTitles = in.getStringArrayExtra("epTitles");
            epImages = in.getStringArrayExtra("epImages") != null ? in.getStringArrayExtra("epImages") : new String[0];
            epFillers = in.getBooleanArrayExtra("epFillers") != null ? in.getBooleanArrayExtra("epFillers") : new boolean[0];
        }
        segStart = in.getDoubleArrayExtra("segStart") != null ? in.getDoubleArrayExtra("segStart") : new double[0];
        segEnd = in.getDoubleArrayExtra("segEnd") != null ? in.getDoubleArrayExtra("segEnd") : new double[0];
        segKind = in.getStringArrayExtra("segKind") != null ? in.getStringArrayExtra("segKind") : new String[0];
        skipped.clear();
        prefetchSent = false;
        action = "";
        // subtitles of the previous episode / source
        stopToz();
        tozTried = false;
        preRunning = false;
        tozCache.clear();
        aheadLines.clear();
        cuesNow = new ArrayList<>();
        enFile = null;
        enLabel = null;
        t1.setText(title);
        t2.setText(subtitle != null ? subtitle : "");
        t2.setVisibility(subtitle != null ? View.VISIBLE : View.GONE);
        // on a phone the gap keeps Play in the middle
        prevBtn.setVisibility(hasPrev ? View.VISIBLE : isTv ? View.GONE : View.INVISIBLE);
        nextBtn.setVisibility(hasNext ? View.VISIBLE : isTv ? View.GONE : View.INVISIBLE);
        epsBtn.setVisibility(epNums.length > 1 ? View.VISIBLE : View.GONE);

        TrackSelectionParameters.Builder tp = player.getTrackSelectionParameters().buildUpon().clearOverrides().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
        String audioLang = in.getStringExtra("audioLang");
        String subLang = in.getStringExtra("subLang");
        subLangs.clear();
        subLangs.add("eng");
        String sl = in.getStringExtra("subLangs");
        if (sl != null) for (String l : sl.split(",")) if (!l.trim().isEmpty()) subLangs.add(iso3(l.trim()));
        if (subLang != null) subLangs.add(iso3(subLang));
        allSubs = false;
        subDelayMs = 0;
        if (cueRenderer != null) cueRenderer.delayUs = 0;
        if (audioLang != null) tp.setPreferredAudioLanguage(audioLang);
        if (subLang != null) tp.setPreferredTextLanguage(subLang).setSelectUndeterminedTextLanguage(true);
        player.setTrackSelectionParameters(tp.build());

        List<MediaItem.SubtitleConfiguration> subs = new ArrayList<>();
        String[] uris = in.getStringArrayExtra("subUris");
        addedLabels.clear();
        String[] lbs = in.getStringArrayExtra("subLabels");
        if (lbs != null) for (String l : lbs) if (l != null) addedLabels.add(l);
        if (uris != null) {
            String[] langs = in.getStringArrayExtra("subLangs"), labels = in.getStringArrayExtra("subLabels"), mimes = in.getStringArrayExtra("subMimes");
            for (int i = 0; i < uris.length; i++) {
                if (enFile == null && langs != null && langs[i] != null && langs[i].startsWith("en")) {
                    enFile = uris[i];
                    enLabel = labels != null ? labels[i] : null;
                }
                subs.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(uris[i]))
                    .setMimeType(mimes != null && mimes[i] != null ? mimes[i] : MimeTypes.APPLICATION_SUBRIP)
                    .setLanguage(langs != null ? langs[i] : null)
                    .setLabel(labels != null ? labels[i] : null)
                    .setSelectionFlags(i == 0 ? C.SELECTION_FLAG_DEFAULT : 0)
                    .build());
            }
        }
        player.setMediaItem(new MediaItem.Builder().setUri(Uri.parse(url)).setSubtitleConfigurations(subs).build(), position);
        player.prepare();
        player.play();
        loading.setVisibility(View.GONE);
        poke();
    }

    /** Previous / next episode: the app finds it while this player shows the waiting screen. */
    private void goEp(int d) {
        sendProgress();
        player.pause();
        int n = episode + d;
        status(null, n > 0 ? n + ". bölüm" : null, n > 0 ? n + ". bölüm hazırlanıyor…" : "Hazırlanıyor…");
        send("player:episode", String.valueOf(d));
    }

    private void sendProgress() {
        long dur = player.getDuration();
        send("player:progress", "{\"position\":" + player.getCurrentPosition() + ",\"duration\":" + (dur == C.TIME_UNSET ? 0 : dur) + "}");
    }

    /**
     * Episodes: a dark panel from the right (like a streaming app) with each episode's picture, number and
     * name; the one playing is marked. Remote: up / down move, OK plays, Back closes. Touch: tap a row,
     * tap outside to close.
     */
    private void episodesDialog() {
        LinearLayout list = openPanel("Bölümler", t1 != null ? String.valueOf(t1.getText()) : null);
        View current = null;
        for (int i = 0; i < epNums.length; i++) {
            View row = episodeRow(i);
            list.addView(row);
            if (epNums[i] == episode) current = row;
        }
        focusPanel(current);
    }

    private android.widget.ScrollView panelScroll;
    private LinearLayout panelList;

    /**
     * A dark panel from the right like a streaming app's (episodes, audio and subtitles, speed, sources):
     * up / down move, OK picks, Back or a tap outside closes. Answers the list to fill.
     */
    private LinearLayout openPanel(String title, String sub) { return openPanel(title, sub, false); }

    private LinearLayout openPanel(String title, String sub, boolean wide) {
        if (epPanel != null) rootView.removeView(epPanel);
        backTo = null;
        controls.setVisibility(View.GONE);
        FrameLayout shade = new FrameLayout(this);
        shade.setBackgroundColor(0x99000000);
        shade.setOnClickListener(v -> closeEpisodes());
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[] { 0xF0141418, 0xFA0E0E11 }));
        panel.setClickable(true);
        panel.setPadding(dp(isTv ? 28 : 18), dp(isTv ? 28 : 16), dp(isTv ? 28 : 18), 0);
        TextView h = new TextView(this);
        h.setText(title);
        h.setTextColor(Color.WHITE);
        h.setTextSize(isTv ? 22 : 19);
        h.setTypeface(null, android.graphics.Typeface.BOLD);
        panel.addView(h);
        TextView st = new TextView(this);
        st.setText(sub != null ? sub : "");
        st.setTextColor(0x99FFFFFF);
        st.setTextSize(13);
        st.setSingleLine(true);
        st.setEllipsize(android.text.TextUtils.TruncateAt.END);
        st.setPadding(0, dp(2), 0, dp(14));
        if (sub != null && !sub.isEmpty()) panel.addView(st);
        else h.setPadding(0, 0, 0, dp(14));
        android.widget.ScrollView sc = new android.widget.ScrollView(this);
        sc.setVerticalScrollBarEnabled(false);
        sc.setClipToPadding(false);
        sc.setPadding(0, 0, 0, dp(24));
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(4), dp(4), dp(4), dp(4)); // room for the focus frame at the edges
        list.setClipToPadding(false);
        sc.addView(list);
        panel.addView(sc, new LinearLayout.LayoutParams(-1, 0, 1));
        int screen = getResources().getDisplayMetrics().widthPixels;
        int w = wide ? Math.min(dp(isTv ? 720 : 640), (int) (screen * 0.8f)) : Math.min(dp(isTv ? 460 : 400), (int) (screen * 0.6f));
        shade.addView(panel, new FrameLayout.LayoutParams(w, -1, Gravity.END));
        epPanel = shade;
        panelScroll = sc;
        panelList = list;
        rootView.addView(shade, new FrameLayout.LayoutParams(-1, -1));
        panel.setTranslationX(w);
        panel.animate().translationX(0).setDuration(220).start();
        return list;
    }

    /** Start the remote on this row (the one in use), scrolled into view; else on the first one. */
    private void focusPanel(View row) {
        final android.widget.ScrollView sc = panelScroll;
        final LinearLayout list = panelList;
        sc.post(() -> {
            View r = row;
            if (r == null) for (int i = 0; i < list.getChildCount(); i++) if (list.getChildAt(i).isFocusable()) { r = list.getChildAt(i); break; }
            if (r == null) return;
            // where the row is in the whole list (it may sit inside a column): scrolled only when it is out of sight
            int top = 0;
            for (View v = r; v != null && v != list; v = (View) v.getParent()) top += v.getTop();
            if (top + r.getHeight() > sc.getHeight() - dp(24)) sc.scrollTo(0, Math.max(0, top - dp(80)));
            r.requestFocus();
        });
    }

    /** A small section title inside a panel ("ALTYAZI", "SES"…). */
    private TextView panelHead(String text) {
        TextView t = new TextView(this);
        t.setText(text.toUpperCase(new Locale("tr")));
        t.setTextColor(0x80FFFFFF);
        t.setTextSize(11.5f);
        t.setLetterSpacing(0.08f);
        t.setTypeface(null, android.graphics.Typeface.BOLD);
        t.setPadding(dp(10), dp(14), 0, dp(6));
        return t;
    }

    /** A panel row: name, a hint under it, a tick when it is the one in use. tag = the name's TextView. */
    private LinearLayout panelRow(String label, String hint, boolean on, View.OnClickListener l) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(isTv ? 11 : 10), dp(12), dp(isTv ? 11 : 10));
        android.graphics.drawable.StateListDrawable bg = new android.graphics.drawable.StateListDrawable();
        GradientDrawable f = round(0x26FFFFFF, 10);
        f.setStroke(dp(2), Color.WHITE);
        bg.addState(new int[] { android.R.attr.state_focused }, f);
        bg.addState(new int[] { android.R.attr.state_pressed }, round(0x1AFFFFFF, 10));
        bg.addState(new int[] {}, on ? round(0x14FFFFFF, 10) : new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        row.setBackground(bg);
        row.setFocusable(true);
        row.setClickable(true);
        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        TextView a = new TextView(this);
        a.setText(label);
        a.setTextColor(on ? 0xFFFBBF24 : Color.WHITE);
        a.setTextSize(isTv ? 15 : 14.5f);
        a.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        text.addView(a);
        if (hint != null && !hint.isEmpty()) {
            TextView b = new TextView(this);
            b.setText(hint);
            b.setTextColor(0x8CFFFFFF);
            b.setTextSize(12);
            b.setPadding(0, dp(2), 0, 0);
            text.addView(b);
        }
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        if (on) {
            TextView tick = new TextView(this);
            tick.setText("✓");
            tick.setTextColor(0xFFFBBF24);
            tick.setTextSize(16);
            tick.setTypeface(null, android.graphics.Typeface.BOLD);
            row.addView(tick);
        }
        row.setTag(a);
        row.setOnClickListener(l);
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(-1, -2);
        rl.setMargins(0, 0, 0, dp(2));
        row.setLayoutParams(rl);
        return row;
    }

    private void closeEpisodes() {
        if (epPanel == null) return;
        rootView.removeView(epPanel);
        epPanel = null;
        backTo = null;
    }

    /** Back in a panel: to the panel it was opened from (a choice list → "Altyazı görünümü" → audio and
     *  subtitles), else closed. */
    private Runnable backTo;
    private void panelBack() {
        Runnable r = backTo;
        if (r != null) r.run(); else closeEpisodes();
    }

    private View episodeRow(int i) {
        int n = epNums[i];
        boolean now = n == episode;
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(8), dp(8), dp(10), dp(8));
        android.graphics.drawable.StateListDrawable bg = new android.graphics.drawable.StateListDrawable();
        GradientDrawable f = round(0x26FFFFFF, 12);
        f.setStroke(dp(2), Color.WHITE);
        bg.addState(new int[] { android.R.attr.state_focused }, f);
        bg.addState(new int[] { android.R.attr.state_pressed }, round(0x1AFFFFFF, 12));
        bg.addState(new int[] {}, now ? round(0x14FFFFFF, 12) : new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        row.setBackground(bg);
        row.setFocusable(true);
        row.setClickable(true);
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(-1, -2);
        rl.setMargins(0, 0, 0, dp(4));
        row.setLayoutParams(rl);

        FrameLayout pic = new FrameLayout(this);
        pic.setBackground(round(0xFF222228, 8));
        pic.setClipToOutline(true);
        android.widget.ImageView img = new android.widget.ImageView(this);
        img.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        pic.addView(img, new FrameLayout.LayoutParams(-1, -1));
        TextView num = new TextView(this);
        num.setText(String.valueOf(n));
        num.setTextColor(Color.WHITE);
        num.setTextSize(11);
        num.setTypeface(null, android.graphics.Typeface.BOLD);
        num.setBackground(round(0xB3000000, 5));
        num.setPadding(dp(5), dp(1), dp(5), dp(1));
        FrameLayout.LayoutParams nl = new FrameLayout.LayoutParams(-2, -2, Gravity.START | Gravity.BOTTOM);
        nl.setMargins(dp(5), 0, 0, dp(5));
        pic.addView(num, nl);
        if (now) {
            android.widget.ImageView play = new android.widget.ImageView(this);
            play.setImageResource(R.drawable.ic_play);
            play.setBackground(round(0x80000000, 18));
            play.setPadding(dp(8), dp(8), dp(8), dp(8));
            pic.addView(play, new FrameLayout.LayoutParams(dp(36), dp(36), Gravity.CENTER));
        }
        row.addView(pic, new LinearLayout.LayoutParams(dp(isTv ? 136 : 120), dp(isTv ? 76 : 68)));
        String url = i < epImages.length ? epImages[i] : null;
        if (url != null && !url.isEmpty()) loadThumb(url, img);

        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(14), 0, 0, 0);
        TextView a = new TextView(this);
        a.setText(n + ". bölüm" + (i < epFillers.length && epFillers[i] ? "  · dolgu" : ""));
        a.setTextColor(now ? 0xFFFBBF24 : Color.WHITE);
        a.setTextSize(14);
        a.setTypeface(null, android.graphics.Typeface.BOLD);
        text.addView(a);
        String t = epTitles != null && i < epTitles.length ? epTitles[i] : null;
        TextView b = new TextView(this);
        b.setText(now ? "Şimdi izleniyor" + (t != null && !t.isEmpty() ? " · " + t : "") : (t != null && !t.isEmpty() ? t : ""));
        b.setTextColor(0x99FFFFFF);
        b.setTextSize(12.5f);
        b.setMaxLines(2);
        b.setEllipsize(android.text.TextUtils.TruncateAt.END);
        b.setPadding(0, dp(2), 0, 0);
        if (b.getText().length() > 0) text.addView(b);
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));

        row.setOnClickListener(v -> {
            closeEpisodes();
            if (n == episode) { poke(); return; }
            sendProgress();
            player.pause();
            status(null, n + ". bölüm", n + ". bölüm hazırlanıyor…");
            send("player:goto", String.valueOf(n));
        });
        return row;
    }

    /** An episode picture, downloaded small once and kept for the session. */
    private void loadThumb(String url, android.widget.ImageView into) {
        android.graphics.Bitmap have = thumbs.get(url);
        if (have != null) { into.setImageBitmap(have); return; }
        into.setTag(url);
        thumbExec.execute(() -> {
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(12000);
                byte[] data;
                try (java.io.InputStream in = c.getInputStream()) { data = readAll(in); }
                android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, o);
                o.inSampleSize = Math.max(1, o.outWidth / dp(160));
                o.inJustDecodeBounds = false;
                android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, o);
                if (bm == null) return;
                thumbs.put(url, bm);
                ui.post(() -> { if (url.equals(into.getTag())) into.setImageBitmap(bm); });
            } catch (Exception ignored) { /* no picture: the grey box stays */ }
        });
    }

    private static byte[] readAll(java.io.InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int r; (r = in.read(buf)) > 0; ) out.write(buf, 0, r);
        return out.toByteArray();
    }

    /** Sources of this episode, sent by the app ("player:sourceList" asked for them), as a panel. */
    void showSources(String[] labels, String[] hints) {
        if (labels.length == 0) { showFlash("Bu bölüm için kaynak bulunamadı", 3000); return; }
        LinearLayout list = openPanel("Kaynaklar", labels.length + " kaynak · en iyisi üstte");
        for (int i = 0; i < labels.length; i++) {
            final int n = i;
            list.addView(panelRow(labels[i], hints[i], false, v -> {
                closeEpisodes();
                sendProgress(); // the new source continues from here
                player.pause();
                status(null, null, "Kaynak hazırlanıyor…");
                send("player:pickSource", String.valueOf(n));
            }));
        }
        focusPanel(null);
    }

    private GradientDrawable round(int color, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    private boolean isTv;

    /** TV bottom-row button (Netflix-like): a soft pill, white with black text while the remote is on it. */
    private LinearLayout tvAction(int res, String label, View.OnClickListener l) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(6), dp(14), dp(6));
        android.content.res.ColorStateList ink = new android.content.res.ColorStateList(
            new int[][] { { android.R.attr.state_focused }, {} }, new int[] { Color.BLACK, 0xB3FFFFFF });
        android.widget.ImageView i = new android.widget.ImageView(this);
        i.setImageResource(res);
        i.setImageTintList(ink);
        i.setDuplicateParentStateEnabled(true);
        row.addView(i, new LinearLayout.LayoutParams(dp(16), dp(16)));
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(ink);
        t.setTextSize(13);
        t.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        t.setPadding(dp(7), 0, 0, 0);
        t.setDuplicateParentStateEnabled(true);
        row.addView(t);
        android.graphics.drawable.StateListDrawable bg = new android.graphics.drawable.StateListDrawable();
        bg.addState(new int[] { android.R.attr.state_focused }, round(Color.WHITE, 16));
        bg.addState(new int[] {}, new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        row.setBackground(bg);
        row.setFocusable(true);
        row.setOnClickListener(v -> { l.onClick(v); poke(); });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.setMargins(0, 0, dp(6), 0);
        row.setLayoutParams(lp);
        return row;
    }

    /**
     * The TV's controls, like a TV streaming app: nothing on top but the quality / Töz badges, a dark fade at
     * the bottom with the title, play + the seek bar, and a row of big buttons. No lock, rotation or touch
     * seek buttons (there is no touch screen); a pause sign in the middle while stopped.
     */
    private View buildTvControls() {
        FrameLayout c = new FrameLayout(this);
        c.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { 0x66000000, 0x00000000, 0x00000000, 0x99000000, 0xEE000000 }));

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        top.setPadding(dp(40), dp(28), dp(48), 0);
        qualityText = new TextView(this);
        qualityText.setTextColor(Color.WHITE);
        qualityText.setTextSize(13);
        qualityText.setTypeface(null, android.graphics.Typeface.BOLD);
        GradientDrawable qb = round(Color.TRANSPARENT, 6);
        qb.setStroke(dp(1.5f), Color.WHITE);
        qualityText.setBackground(qb);
        qualityText.setPadding(dp(8), dp(3), dp(8), dp(3));
        qualityText.setVisibility(View.GONE);
        LinearLayout.LayoutParams ql = new LinearLayout.LayoutParams(-2, -2);
        ql.setMargins(dp(8), 0, 0, 0);
        top.addView(qualityText, ql);
        tozState = new TextView(this);
        tozState.setTextColor(Color.BLACK);
        tozState.setTextSize(13);
        tozState.setTypeface(null, android.graphics.Typeface.BOLD);
        tozState.setBackground(round(Color.WHITE, 6));
        tozState.setPadding(dp(8), dp(3), dp(8), dp(3));
        tozState.setVisibility(View.GONE);
        top.addView(tozState, ql);
        c.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        android.widget.ImageView mark = new android.widget.ImageView(this);
        mark.setImageResource(R.drawable.ic_play);
        mark.setBackground(round(0x66000000, 60));
        mark.setPadding(dp(20), dp(20), dp(20), dp(20));
        mark.setVisibility(View.GONE);
        mark.setTranslationY(-dp(90)); // above the subtitle line
        pausedMark = mark;
        c.addView(mark, new FrameLayout.LayoutParams(dp(88), dp(88), Gravity.CENTER));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(44), 0, dp(44), dp(22));
        // the button row is pulled left to line up with the title: it must not be cut at the padding
        bottom.setClipToPadding(false);
        bottom.setClipChildren(false);
        t1 = new TextView(this);
        t1.setTextColor(Color.WHITE);
        t1.setTextSize(18);
        t1.setTypeface(null, android.graphics.Typeface.BOLD);
        t1.setSingleLine(true);
        t1.setEllipsize(android.text.TextUtils.TruncateAt.END);
        bottom.addView(t1);
        t2 = new TextView(this);
        t2.setTextColor(0x99FFFFFF);
        t2.setTextSize(13);
        t2.setSingleLine(true);
        t2.setPadding(0, dp(1), 0, dp(6));
        bottom.addView(t2);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        playBtn = icon(R.drawable.ic_pause, 38, v -> { if (player.isPlaying()) player.pause(); else player.play(); });
        playBtn.setPadding(dp(8), dp(8), dp(8), dp(8));
        prevBtn = icon(R.drawable.ic_prev, 38, v -> goEp(-1));
        prevBtn.setPadding(dp(9), dp(9), dp(9), dp(9));
        nextBtn = icon(R.drawable.ic_next, 38, v -> goEp(1));
        nextBtn.setPadding(dp(9), dp(9), dp(9), dp(9));
        bar.addView(prevBtn);
        bar.addView(playBtn);
        bar.addView(nextBtn);
        FrameLayout seekWrap = new FrameLayout(this);
        segBar = new SegmentBar(this);
        FrameLayout.LayoutParams sl = new FrameLayout.LayoutParams(-1, dp(4), Gravity.CENTER_VERTICAL);
        sl.setMargins(dp(16), 0, dp(16), 0);
        seekWrap.addView(segBar, sl);
        seek = new SeekBar(this);
        seekWrap.addView(seek, new FrameLayout.LayoutParams(-1, dp(40), Gravity.CENTER_VERTICAL));
        LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(0, -2, 1);
        wl.setMargins(dp(8), 0, dp(8), 0);
        bar.addView(seekWrap, wl);
        posText = new TextView(this);
        posText.setTextColor(Color.WHITE);
        posText.setTextSize(13);
        bar.addView(posText);
        TextView slash = new TextView(this);
        slash.setText(" / ");
        slash.setTextColor(0x99FFFFFF);
        slash.setTextSize(13);
        bar.addView(slash);
        durText = new TextView(this);
        durText.setTextColor(0x99FFFFFF);
        durText.setTextSize(13);
        bar.addView(durText);
        bottom.addView(bar);

        LinearLayout acts = new LinearLayout(this);
        acts.setGravity(Gravity.CENTER_VERTICAL);
        acts.setPadding(0, dp(6), 0, 0);
        acts.setTranslationX(-dp(12)); // the first label lines up with the title (its padding is inside)
        epsBtn = tvAction(R.drawable.ic_subs, "Bölümler", v -> episodesDialog());
        acts.addView(epsBtn);
        acts.addView(tvAction(R.drawable.ic_subs, "Ses ve altyazı", v -> tracksDialog()));
        acts.addView(tvAction(R.drawable.ic_cloud, "Kaynaklar", v -> { showFlash("Kaynaklar aranıyor…", 2500); send("player:sourceList", "0"); }));
        acts.addView(tvAction(R.drawable.ic_speed, "Hız", v -> speedDialog()));
        bottom.addView(acts);
        c.addView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        setupSeek();
        return c;
    }

    private View buildControls() {
        isTv = tv();
        if (isTv) return buildTvControls();
        FrameLayout c = new FrameLayout(this);
        c.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { 0xCC000000, 0x33000000, 0x33000000, 0xDD000000 }));
        c.setOnClickListener(v -> c.setVisibility(View.GONE));

        // top: back · title · aspect · quality · lock
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(12), dp(10), dp(16), 0);
        top.addView(icon(R.drawable.ic_back, 48, v -> finishWithResult()));
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(6), 0, dp(6), 0);
        t1 = new TextView(this);
        t1.setTextColor(Color.WHITE);
        t1.setTextSize(17);
        t1.setTypeface(null, android.graphics.Typeface.BOLD);
        t1.setSingleLine(true);
        t1.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titles.addView(t1);
        t2 = new TextView(this);
        t2.setTextColor(0xCCFFFFFF);
        t2.setTextSize(13);
        t2.setSingleLine(true);
        t2.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titles.addView(t2);
        top.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        top.addView(icon(R.drawable.ic_aspect, 48, v -> cycleAspect()));
        qualityText = new TextView(this);
        qualityText.setTextColor(Color.WHITE);
        qualityText.setTextSize(12);
        qualityText.setTypeface(null, android.graphics.Typeface.BOLD);
        GradientDrawable qb = round(Color.TRANSPARENT, 6);
        qb.setStroke(dp(1.5f), Color.WHITE);
        qualityText.setBackground(qb);
        qualityText.setPadding(dp(7), dp(2), dp(7), dp(2));
        qualityText.setVisibility(View.GONE); // shown once the video size is known
        LinearLayout.LayoutParams ql = new LinearLayout.LayoutParams(-2, -2);
        ql.setMargins(dp(6), 0, dp(6), 0);
        top.addView(qualityText, ql);
        tozState = new TextView(this);
        tozState.setTextColor(Color.BLACK);
        tozState.setTextSize(12);
        tozState.setTypeface(null, android.graphics.Typeface.BOLD);
        tozState.setBackground(round(Color.WHITE, 6));
        tozState.setPadding(dp(7), dp(2), dp(7), dp(2));
        tozState.setVisibility(View.GONE);
        top.addView(tozState, ql);
        // (the lock is in the bottom row, with the other buttons)
        c.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        // center: -10 · play · +10
        LinearLayout mid = new LinearLayout(this);
        mid.setGravity(Gravity.CENTER);
        prevBtn = icon(R.drawable.ic_prev, 52, v -> goEp(-1));
        nextBtn = icon(R.drawable.ic_next, 52, v -> goEp(1));
        LinearLayout.LayoutParams el = new LinearLayout.LayoutParams(dp(52), dp(52));
        el.setMargins(0, 0, dp(36), 0);
        mid.addView(prevBtn, el);
        mid.addView(icon(R.drawable.ic_replay, 64, v -> seekBy(-10000)));
        playBtn = icon(R.drawable.ic_pause, 84, v -> { if (player.isPlaying()) player.pause(); else player.play(); });
        LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(dp(84), dp(84));
        pl.setMargins(dp(48), 0, dp(48), 0);
        mid.addView(playBtn, pl);
        mid.addView(icon(R.drawable.ic_forward, 64, v -> seekBy(10000)));
        LinearLayout.LayoutParams er = new LinearLayout.LayoutParams(dp(52), dp(52));
        er.setMargins(dp(36), 0, 0, 0);
        mid.addView(nextBtn, er);
        c.addView(mid, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));

        // bottom: times + bar (OP/ED marked) · actions
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(20), 0, dp(20), dp(10));
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        posText = new TextView(this);
        posText.setTextColor(Color.WHITE);
        posText.setTextSize(14);
        bar.addView(posText);
        FrameLayout seekWrap = new FrameLayout(this);
        segBar = new SegmentBar(this);
        FrameLayout.LayoutParams sl = new FrameLayout.LayoutParams(-1, dp(4), Gravity.CENTER_VERTICAL);
        sl.setMargins(dp(16), 0, dp(16), 0);
        seekWrap.addView(segBar, sl);
        seek = new SeekBar(this);
        setupSeek();
        seekWrap.addView(seek, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER_VERTICAL));
        bar.addView(seekWrap, new LinearLayout.LayoutParams(0, -2, 1));
        durText = new TextView(this);
        durText.setTextColor(Color.WHITE);
        durText.setTextSize(14);
        bar.addView(durText);
        bottom.addView(bar);
        return buildActions(c, bottom);
    }

    private void setupSeek() {
        seek.setMax(1000);
        seek.setKeyProgressIncrement(5); // one press of the remote: half a percent (about 7 s of an episode)
        seek.setBackground(focusFrame());
        seek.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        seek.setThumbTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        seek.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(0x44FFFFFF));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean user) {
                if (user) posText.setText(time(p * player.getDuration() / 1000));
                // moved with the remote's arrows (no finger on it): go there now
                if (user && !dragging) player.seekTo(p * player.getDuration() / 1000);
            }
            @Override public void onStartTrackingTouch(SeekBar s) { dragging = true; ui.removeCallbacks(hide); }
            @Override public void onStopTrackingTouch(SeekBar s) {
                dragging = false;
                player.seekTo(s.getProgress() * player.getDuration() / 1000);
                poke();
            }
        });
    }

    private View buildActions(FrameLayout c, LinearLayout bottom) {
        // A phone streaming app's bottom row: the buttons spread evenly across, the lock among them.
        LinearLayout acts = new LinearLayout(this);
        acts.setGravity(Gravity.CENTER_VERTICAL);
        epsBtn = action(R.drawable.ic_subs, "Bölümler", v -> episodesDialog());
        View[] row = {
            action(R.drawable.ic_speed, "Hız", v -> speedDialog()),
            action(R.drawable.ic_lock, "Kilitle", v -> { locked = true; controls.setVisibility(View.GONE); lockOverlay.setVisibility(View.VISIBLE); }),
            epsBtn,
            action(R.drawable.ic_subs, "Ses ve altyazı", v -> tracksDialog()),
            action(R.drawable.ic_cloud, "Kaynaklar", v -> { showFlash("Kaynaklar aranıyor…", 2500); send("player:sourceList", "0"); }),
        };
        for (View b : row) {
            ((LinearLayout) b).setGravity(Gravity.CENTER);
            acts.addView(b, new LinearLayout.LayoutParams(0, -2, 1));
        }
        // next / previous episode sit beside Play
        bottom.addView(acts);
        c.addView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        return c;
    }

    /** Thin bar under the seek bar: OP / ED / recap parts in amber. */
    private class SegmentBar extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        SegmentBar(Context ctx) { super(ctx); p.setColor(0xFFFBBF24); }
        @Override protected void onDraw(Canvas cv) {
            long dur = player != null ? player.getDuration() : 0;
            if (dur <= 0) return;
            for (int i = 0; i < segStart.length; i++) {
                float a = (float) (segStart[i] * 1000 / dur) * getWidth();
                float b = (float) (segEnd[i] * 1000 / dur) * getWidth();
                cv.drawRect(a, 0, b, getHeight(), p);
            }
        }
    }

    private int currentSegment(double t) {
        for (int i = 0; i < segStart.length; i++) if (t >= segStart[i] && t < segEnd[i] - 2) return i;
        return -1;
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player != null) {
                long pos = player.getCurrentPosition(), dur = player.getDuration();
                if (dur > 0 && !dragging) {
                    seek.setProgress((int) (pos * 1000 / dur));
                    seek.setSecondaryProgress((int) (player.getBufferedPosition() * 1000 / dur));
                    posText.setText(time(pos));
                    durText.setText(time(dur));
                    segBar.invalidate();
                }
                // the translated line moves up above the bar while the controls show
                boolean up = controls.getVisibility() == View.VISIBLE;
                if (view.getSubtitleView() != null) view.getSubtitleView().setBottomPaddingFraction(subBottom(up));
                // two and a half minutes before the end: the app finds the next episode's source now, so
                // the switch at the end doesn't wait for the search
                // subtitles matched to the sound once per video, after the first seconds of playback
                // after ~3 minutes of playback (past the opening song): enough speech heard to match the lines
                if (!autoSyncDone && dur > 0 && player.isPlaying() && audioTap != null && audioTap.seconds() >= 150) {
                    autoSyncDone = true;
                    runAutoSync(true);
                }
                if (hasNext && !prefetchSent && dur > 0 && dur - pos < 150000 && pos > 30000) {
                    prefetchSent = true;
                    send("player:prefetch", "1");
                }
                int s = currentSegment(pos / 1000.0);
                if (s >= 0) {
                    String kind = segKind[s];
                    // OP and ED are skipped on their own switches (set in the app)
                    boolean auto = (kind.equals("op") && autoSkipOp) || (kind.equals("ed") && autoSkipEd);
                    if (auto && !skipped.contains(s)) {
                        skipped.add(s);
                        player.seekTo((long) (segEnd[s] * 1000));
                        showFlash(kind.equals("op") ? "Opening atlandı" : kind.equals("ed") ? "Ending atlandı" : "Atlandı", 1500);
                    } else if (!auto) {
                        final int idx = s;
                        skipBtn.setText(kind.equals("op") ? "Openingi atla  ▸▸" : kind.equals("ed") ? "Endingi atla  ▸▸" : kind.equals("recap") ? "Özeti atla  ▸▸" : "Atla  ▸▸");
                        skipBtn.setOnClickListener(v -> player.seekTo((long) (segEnd[idx] * 1000)));
                        skipBtn.setVisibility(locked ? View.GONE : View.VISIBLE);
                    }
                } else skipBtn.setVisibility(View.GONE);
            }
            ui.postDelayed(this, 400);
        }
    };

    private final Runnable hide = () -> { if (player != null && player.isPlaying() && !dragging) { controls.setVisibility(View.GONE); subPos(); } };

    /** Subtitles above the controls while they are up (right away, also while paused). */
    private void subPos() {
        if (view != null && view.getSubtitleView() != null) view.getSubtitleView().setBottomPaddingFraction(subBottom(controls.getVisibility() == View.VISIBLE));
    }

    private void poke() {
        if (locked) return;
        controls.setVisibility(View.VISIBLE);
        subPos();
        ui.removeCallbacks(hide);
        ui.postDelayed(hide, isTv ? 8000 : 4000); // a remote is slower than a finger
    }

    private void seekBy(long ms) {
        player.seekTo(Math.max(0, player.getCurrentPosition() + ms));
        showFlash((ms > 0 ? "+" : "−") + Math.abs(ms / 1000) + " sn", 700);
    }

    private void showFlash(String text, long ms) {
        flash.setText(text);
        flash.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideFlash);
        ui.postDelayed(hideFlash, ms);
    }

    private final Runnable hideFlash = () -> flash.setVisibility(View.GONE);

    private void cycleAspect() {
        aspect = (aspect + 1) % 3;
        int[] modes = { AspectRatioFrameLayout.RESIZE_MODE_FIT, AspectRatioFrameLayout.RESIZE_MODE_ZOOM, AspectRatioFrameLayout.RESIZE_MODE_FILL };
        String[] names = { "Sığdır", "Yakınlaştır", "Doldur" };
        view.setResizeMode(modes[aspect]);
        showFlash(names[aspect], 900);
    }

    private void speedDialog() {
        final float[] v = { 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f };
        String[] names = { "0.5x", "0.75x", "Normal", "1.25x", "1.5x", "1.75x", "2x" };
        LinearLayout list = openPanel("Oynatma hızı", null);
        View cur = null;
        for (int i = 0; i < v.length; i++) {
            final float sp = v[i];
            boolean on = Math.abs(sp - player.getPlaybackParameters().speed) < 0.01;
            View r = panelRow(names[i], null, on, x -> { player.setPlaybackParameters(new PlaybackParameters(sp)); closeEpisodes(); });
            list.addView(r);
            if (on) cur = r;
        }
        focusPanel(cur);
    }

    /* ------------------------------ subtitle look ------------------------------ */
    // Saved on the device; the file's own style can be kept instead (ASS colours and fonts).
    private static final String[] SIZE_NAMES = { "Küçük", "Orta", "Büyük", "Çok büyük" };
    private static final float[] SIZES = { 0.042f, 0.052f, 0.064f, 0.078f };
    private static final String[] COLOR_NAMES = { "Beyaz", "Sarı" };
    private static final int[] COLORS = { Color.WHITE, 0xFFFDE047 };
    private static final String[] BG_NAMES = { "Kenar çizgisi", "Gölge", "Yarı saydam kutu" };
    private static final String[] POS_NAMES = { "En altta", "Biraz yukarıda" };
    private static final float[] POS = { 0.06f, 0.13f };

    private android.content.SharedPreferences subPrefs() { return getSharedPreferences("subs", MODE_PRIVATE); }

    private void applySubStyle() {
        androidx.media3.ui.SubtitleView sv = view.getSubtitleView();
        if (sv == null) return;
        android.content.SharedPreferences sp = subPrefs();
        boolean own = sp.getBoolean("own", false);
        sv.setApplyEmbeddedStyles(own);
        sv.setApplyEmbeddedFontSizes(own);
        int bg = sp.getInt("bg", 0);
        int fg = COLORS[Math.min(sp.getInt("color", 0), COLORS.length - 1)];
        sv.setStyle(new androidx.media3.ui.CaptionStyleCompat(fg, bg == 2 ? 0xA6000000 : Color.TRANSPARENT, Color.TRANSPARENT,
            bg == 0 ? androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_OUTLINE : bg == 1 ? androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW : androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_NONE,
            Color.BLACK, android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)));
        sv.setFractionalTextSize(SIZES[Math.min(sp.getInt("size", 1), SIZES.length - 1)] * (isTv ? 0.9f : 1f));
    }

    /** Bottom gap under the subtitles: the chosen one, more while the controls are up. */
    private float subBottom(boolean controlsUp) {
        float base = POS[Math.min(subPrefs().getInt("pos", 0), POS.length - 1)];
        return controlsUp ? Math.max(base, isTv ? 0.32f : 0.24f) : base;
    }

    private static String langName(String l) {
        if (l == null || l.equals("und")) return "Bilinmeyen dil";
        Locale loc = Locale.forLanguageTag(l);
        String n = loc.getDisplayLanguage(new Locale("tr"));
        return n.isEmpty() ? l : n.substring(0, 1).toUpperCase(new Locale("tr")) + n.substring(1);
    }

    /** A column of a two-column panel (Ses | Altyazı), with its title. */
    private LinearLayout column(LinearLayout row, String title) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.addView(panelHead(title));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
        lp.setMargins(dp(4), 0, dp(4), 0);
        row.addView(c, lp);
        return c;
    }

    /**
     * Audio and subtitles side by side, like a streaming app: the audio tracks on the left; on the right the
     * subtitles (off, one "Türkçe · AI çeviri" made from the best English one, the video's own and the
     * app's) and "Altyazı görünümü", which opens its own panel.
     */
    private void tracksDialog() {
        Tracks tracks = player.getCurrentTracks();
        LinearLayout list = openPanel("Ses ve altyazı", null, true);
        LinearLayout cols = new LinearLayout(this);
        list.addView(cols, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout audioCol = column(cols, "Ses");
        LinearLayout subCol = column(cols, "Altyazı");
        View cur = null;

        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_AUDIO) continue;
            for (int i = 0; i < g.length; i++) {
                Format f = g.getTrackFormat(i);
                final TrackGroup tg = g.getMediaTrackGroup();
                final int idx = i;
                String ch = f.channelCount > 2 ? (f.channelCount == 6 ? "5.1" : f.channelCount + " kanal") : f.channelCount == 2 ? "Stereo" : null;
                String hint = f.label != null && !f.label.isEmpty() ? f.label + (ch != null ? " · " + ch : "") : ch;
                String an = f.language == null || f.language.equals("und") ? "Orijinal ses" : langName(f.language);
                audioCol.addView(panelRow(an, hint, g.isTrackSelected(i), v -> {
                    closeEpisodes();
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setOverrideForType(new TrackSelectionOverride(tg, idx)).build());
                }));
            }
        }

        boolean anyText = false;
        for (Tracks.Group g : tracks.getGroups()) if (g.getType() == C.TRACK_TYPE_TEXT && g.isSelected()) anyText = true;
        View off = panelRow("Kapalı", null, !anyText, v -> {
            closeEpisodes();
            stopToz();
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
        });
        subCol.addView(off);
        if (!anyText) cur = off;
        int[] ai = aiTrack(tracks);
        if (ai != null) {
            final TrackGroup tg = tracks.getGroups().get(ai[0]).getMediaTrackGroup();
            final int idx = ai[1];
            View r = panelRow("Türkçe · AI çeviri", "İngilizceden, bu cihazda", tozLive, v -> { closeEpisodes(); startToz(tg, idx); });
            subCol.addView(r);
            if (tozLive) cur = r;
        }
        java.util.Set<String> names = new java.util.HashSet<>();
        int hidden = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < g.length; i++) {
                Format f = g.getTrackFormat(i);
                final TrackGroup tg = g.getMediaTrackGroup();
                final int idx = i;
                // Only the viewer's languages (and English, and tracks with no language) unless "Diğer
                // diller" was opened: a multi-sub release listed ten languages nobody asked for.
                String l3 = iso3(f.language);
                if (!allSubs && !l3.isEmpty() && !subLangs.isEmpty() && !subLangs.contains(l3) && !(g.isTrackSelected(i) && !tozLive)) {
                    hidden++;
                    continue;
                }
                String lang = langName(f.language);
                String name = f.label != null && !f.label.isEmpty() ? f.label : lang;
                String hint = f.label != null && !f.label.isEmpty() && !f.label.toLowerCase(new Locale("tr")).contains(lang.toLowerCase(new Locale("tr"))) ? lang : null;
                if (!names.add(name + "|" + hint)) name = name + " (" + (i + 1) + ")";
                boolean on = g.isTrackSelected(i) && !tozLive;
                View r = panelRow(name, hint, on, v -> {
                    closeEpisodes();
                    stopToz();
                    player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(new TrackSelectionOverride(tg, idx)).build());
                });
                subCol.addView(r);
                if (on) cur = r;
            }
        }
        if (hidden > 0) {
            View more = panelRow("Diğer diller (" + hidden + ")  ›", null, false, v -> { allSubs = true; tracksDialog(); });
            subCol.addView(more);
        }
        View timing = panelRow("Zamanlama  ›", delayText(subDelayMs), false, v -> delayDialog(null));
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(-1, -2);
        tl.setMargins(0, dp(10), 0, 0);
        subCol.addView(timing, tl);
        View look = panelRow("Altyazı görünümü  ›", lookSummary(), false, v -> lookDialog(null));
        LinearLayout.LayoutParams ll = new LinearLayout.LayoutParams(-1, -2);
        ll.setMargins(0, dp(10), 0, 0);
        subCol.addView(look, ll);
        focusPanel(cur);
    }

    private String lookSummary() {
        android.content.SharedPreferences sp = subPrefs();
        if (sp.getBoolean("own", false)) return "Dosyanın kendi stili";
        return SIZE_NAMES[Math.min(sp.getInt("size", 1), SIZE_NAMES.length - 1)] + " · " + COLOR_NAMES[Math.min(sp.getInt("color", 0), COLOR_NAMES.length - 1)]
            + " · " + BG_NAMES[Math.min(sp.getInt("bg", 0), BG_NAMES.length - 1)].toLowerCase(new Locale("tr"));
    }

    /** "Altyazı görünümü": each setting shows its value and opens the list of choices. */
    private void lookDialog(String focusKey) {
        LinearLayout list = openPanel("Altyazı görünümü", "Değişiklik altyazıda hemen görünür");
        backTo = this::tracksDialog;
        android.content.SharedPreferences sp = subPrefs();
        String[] own = { "Kapalı", "Açık" };
        String[][] all = { SIZE_NAMES, COLOR_NAMES, BG_NAMES, POS_NAMES, own };
        String[] keys = { "size", "color", "bg", "pos", "own" };
        String[] titles = { "Boyut", "Renk", "Arka plan", "Konum", "Dosyanın kendi stili" };
        int[] defs = { 1, 0, 0, 0, 0 };
        View cur = null;
        for (int k = 0; k < keys.length; k++) {
            final int kk = k;
            int val = keys[k].equals("own") ? (sp.getBoolean("own", false) ? 1 : 0) : Math.min(sp.getInt(keys[k], defs[k]), all[k].length - 1);
            View r = panelRow(titles[k], all[k][val], false, v -> choicePanel(titles[kk], keys[kk], all[kk], defs[kk]));
            list.addView(r);
            if (keys[k].equals(focusKey)) cur = r;
        }
        focusPanel(cur);
    }

    /** The choices of one look setting; the pick is applied and saved, and Back / a pick returns. */
    private void choicePanel(String title, String key, String[] values, int def) {
        LinearLayout list = openPanel(title, null);
        backTo = () -> lookDialog(key);
        android.content.SharedPreferences sp = subPrefs();
        int val = key.equals("own") ? (sp.getBoolean("own", false) ? 1 : 0) : Math.min(sp.getInt(key, def), values.length - 1);
        View cur = null;
        for (int i = 0; i < values.length; i++) {
            final int n = i;
            View r = panelRow(values[i], null, i == val, v -> {
                if (key.equals("own")) sp.edit().putBoolean("own", n == 1).apply();
                else sp.edit().putInt(key, n).apply();
                applySubStyle();
                refreshCues();
                lookDialog(key);
            });
            list.addView(r);
            if (i == val) cur = r;
        }
        focusPanel(cur);
    }

    /** The English track the AI translates: the video's own first (its timing fits this exact file),
     *  else the subtitle the app downloaded. {group index, track index} or null. */
    private int[] aiTrack(Tracks tracks) {
        int[] fromFile = null, fromApp = null;
        for (int gi = 0; gi < tracks.getGroups().size(); gi++) {
            Tracks.Group g = tracks.getGroups().get(gi);
            if (g.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < g.length; i++) {
                Format f = g.getTrackFormat(i);
                if (!englishLike(f)) continue;
                boolean added = f.label != null && addedLabels.contains(f.label);
                if (added) { if (fromApp == null) fromApp = new int[] { gi, i }; }
                else if (fromFile == null) fromFile = new int[] { gi, i };
            }
        }
        return fromFile != null ? fromFile : fromApp;
    }

    /** English, or a track whose language the file doesn't say (nearly always English); not signs / songs. */
    private static boolean englishLike(Format f) {
        String l = f.language, lb = f.label != null ? f.label.toLowerCase(Locale.ROOT) : "";
        if (lb.contains("sign") || lb.contains("song") || lb.contains("otomatik")) return false;
        return l == null || l.startsWith("en") || l.equals("und") || l.equals("unk");
    }

    private void startToz(TrackGroup tg, int idx) {
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(new TrackSelectionOverride(tg, idx)).build());
        tozLive = true;
        Format f = tg.getFormat(idx);
        boolean external = enFile != null && f.label != null && f.label.equals(enLabel);
        if (external) startPretranslate();
        else setTozState("AI · canlı");
        // the lines already buffered ahead: translated now, nearest first
        long now = cueRenderer != null ? cueRenderer.now : 0;
        for (Object[] it : aheadLines) if ((long) it[1] >= now - 2_000_000) queueLine((String) it[0], (long) it[1]);
        refreshCues();
        showFlash("Türkçe altyazı: AI çeviri", 2500);
    }

    private void setTozState(String t) {
        tozState.setText(t);
        tozState.setVisibility(t == null ? View.GONE : View.VISIBLE);
    }

    /** Same text whatever the source: ASS tags gone, line breaks and runs of spaces as one space. */
    private static String norm(String t) {
        return t.replaceAll("\\{[^}]*\\}", "").replace("\\N", " ").replace("\\n", " ").replace("\\h", " ").replaceAll("\\s+", " ").trim();
    }

    private String tozLine(String en) throws Exception {
        if (tozDir == null) tozDir = PlayerPlugin.unpackToz(this);
        return tozTranslate(tozDir.getAbsolutePath(), en);
    }

    /** The English subtitle file, line by line, nearest to the viewer first; live lines go between these. */
    private void startPretranslate() {
        if (preRunning) return;
        preRunning = true;
        final long posMs = player.getCurrentPosition();
        tozExec.execute(() -> {
            final List<long[]> order = new ArrayList<>();
            final List<String> texts = new ArrayList<>();
            try (java.io.BufferedReader rd = new java.io.BufferedReader(new java.io.InputStreamReader(getContentResolver().openInputStream(Uri.parse(enFile)), "UTF-8"))) {
                String l;
                java.util.Set<String> seen = new java.util.HashSet<>();
                while ((l = rd.readLine()) != null) {
                    if (!l.startsWith("Dialogue:")) continue;
                    String[] p = l.substring(9).split(",", 10);
                    if (p.length < 10) continue;
                    String t = norm(p[9]);
                    if (t.isEmpty() || !seen.add(t)) continue;
                    String[] hms = p[1].trim().split(":");
                    long ms = (long) ((Integer.parseInt(hms[0]) * 3600 + Integer.parseInt(hms[1]) * 60 + Double.parseDouble(hms[2])) * 1000);
                    order.add(new long[] { ms, texts.size() });
                    texts.add(t);
                }
            } catch (Exception e) {
                ui.post(() -> setTozState("AI · canlı"));
                return;
            }
            // from a little before the viewer on, then what was before
            java.util.Collections.sort(order, (a, b) -> {
                boolean aa = a[0] >= posMs - 10000, bb = b[0] >= posMs - 10000;
                if (aa != bb) return aa ? -1 : 1;
                return Long.compare(a[0], b[0]);
            });
            preTotal = texts.size();
            preDone = 0;
            final java.util.Iterator<long[]> it = order.iterator();
            Runnable step = new Runnable() {
                @Override public void run() {
                    if (!it.hasNext()) { ui.post(() -> setTozState("AI · hazır")); return; }
                    String en = texts.get((int) it.next()[1]);
                    if (!tozCache.containsKey(en)) {
                        String tr = null;
                        try { tr = tozLine(en); } catch (Throwable e) { /* keep going */ }
                        final String out = tr == null || tr.isEmpty() ? null : tr;
                        if (out != null) ui.post(() -> { tozCache.put(en, out); refreshCues(); });
                    }
                    preDone++;
                    final int pct = preTotal > 0 ? preDone * 100 / preTotal : 100;
                    ui.post(() -> setTozState("AI · %" + pct));
                    tozExec.execute(this); // one line at a time: a line on screen waits for one line at most
                }
            };
            ui.post(() -> setTozState("AI · %0"));
            tozExec.execute(step);
        });
    }

    private void stopToz() {
        setTozState(null);
        tozLive = false;
        lineQueue.clear();
        queued.clear();
        refreshCues();
    }

    /**
     * Dialogue lines at the bottom go to the standard place (the file pins them near the bottom edge), so
     * they move up above the controls while those are up; signs and lines placed higher stay where the file
     * puts them. With "Dosyanın kendi stili" on, nothing is moved.
     */
    private androidx.media3.common.text.Cue place(androidx.media3.common.text.Cue q) {
        if (subPrefs().getBoolean("own", false)) return q;
        boolean bottom = q.line == androidx.media3.common.text.Cue.DIMEN_UNSET
            || (q.lineType == androidx.media3.common.text.Cue.LINE_TYPE_FRACTION && q.line >= 0.6f)
            || (q.lineType == androidx.media3.common.text.Cue.LINE_TYPE_NUMBER && q.line < 0);
        if (!bottom) return q;
        return q.buildUpon()
            .setLine(androidx.media3.common.text.Cue.DIMEN_UNSET, androidx.media3.common.text.Cue.TYPE_UNSET)
            .setLineAnchor(androidx.media3.common.text.Cue.TYPE_UNSET)
            .setPosition(androidx.media3.common.text.Cue.DIMEN_UNSET)
            .setPositionAnchor(androidx.media3.common.text.Cue.TYPE_UNSET)
            .build();
    }

    /* ------------------------- subtitles: shown and read ahead ------------------------- */
    private CueRenderer cueRenderer;
    private AudioTap audioTap;
    private String mediaUrl;
    private boolean autoSyncDone;
    private volatile boolean syncing;
    /** Subtitle tracks the automatic sync found not to fit this video (it moves on to another one) */
    private final java.util.Set<String> syncTried = new java.util.HashSet<>();
    private final java.util.concurrent.ExecutorService syncExec = java.util.concurrent.Executors.newSingleThreadExecutor();

    private boolean textOn() {
        for (Tracks.Group g : player.getCurrentTracks().getGroups()) if (g.getType() == C.TRACK_TYPE_TEXT && g.isSelected()) return true;
        return false;
    }

    /**
     * Subtitles matched to the sound (like the PC player and Nuvio): a few minutes of the video's sound are
     * scanned for speech and the lines are moved where they meet it. On its own once per video (a stretch
     * ~30 % in, past the opening song, where there is plenty of talk; lines of an embedded track that aren't
     * read yet there make it skip quietly, and those are in sync anyway), or from "Zamanlama" around the
     * current spot. A subtitle that doesn't fit at all is swapped for another one in the same language.
     */
    private void runAutoSync(boolean auto) {
        if (syncing || cueRenderer == null || mediaUrl == null || player == null || !textOn()) {
            if (!auto && !textOn()) showFlash("Önce bir altyazı seç", 2000);
            return;
        }
        syncing = true;
        long pos = player.getCurrentPosition(), dur = player.getDuration();
        final long off = cueRenderer.now - pos * 1000; // the renderers' clock − video time
        // the sound just played (up to 3 minutes; at least one)
        final Object[] heard = audioTap == null ? null : audioTap.last(180, auto ? 150 : 50);
        if (heard == null) {
            syncing = false;
            if (!auto) showFlash("Eşitlemek için önce bir dakika kadar izle", 2500);
            return;
        }
        final double from = ((long) heard[0] - off) / 1e6;
        final double before = subDelayMs / 1000.0;
        final String url = mediaUrl;
        if (!auto) showFlash("Altyazı sesle eşitleniyor…", 4000);
        syncExec.execute(() -> {
            AutoSync.Result r = null;
            String err = null;
            try {
                float[] sp = AutoSync.speech(this, (float[]) heard[1]);
                r = AutoSync.align(sp, from, cueRenderer.cueTimes(off), before, 30);
            } catch (Throwable e) {
                err = e.getMessage();
            }
            final AutoSync.Result res = r;
            final String error = err;
            ui.post(() -> {
                syncing = false;
                android.util.Log.i("AnisakiSync", res == null ? "failed: " + error : "shift=" + res.shift + " conf=" + res.confidence + " score=" + res.score + " z=" + res.z + " cues=" + res.cues + " auto=" + auto);
                if (player == null || !url.equals(mediaUrl)) return;
                if (res == null) {
                    if (!auto) showFlash(error != null ? error : "Eşitlenemedi", 3500);
                    return;
                }
                if (res.usable()) {
                    subDelayMs = Math.round((before + res.shift) * 1000);
                    if (cueRenderer != null) cueRenderer.delayUs = subDelayMs * 1000;
                    if (!auto || Math.abs(res.shift) >= 0.15) showFlash("Altyazı sesle eşitlendi · " + delayText(subDelayMs), 2500);
                } else if (auto && !res.fits() && trySubSwap()) {
                    showFlash("Altyazı bu videoya uymuyor, başkası deneniyor…", 2500);
                    ui.postDelayed(() -> runAutoSync(true), 4000);
                } else if (!auto) {
                    showFlash("Ses ile altyazı arasında net bir eşleşme bulunamadı; altyazıya dokunmadım.", 3500);
                }
            });
        });
    }

    /** Selects another subtitle in the same language that the sync hasn't tried (up to three). */
    private boolean trySubSwap() {
        if (syncTried.size() >= 3) return false;
        Tracks tracks = player.getCurrentTracks();
        String lang = null;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < g.length; i++) if (g.isTrackSelected(i)) {
                Format f = g.getTrackFormat(i);
                lang = iso3(f.language);
                syncTried.add(g.getMediaTrackGroup().id + "/" + i);
            }
        }
        if (lang == null || tozLive) return false;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < g.length; i++) {
                String key = g.getMediaTrackGroup().id + "/" + i;
                if (syncTried.contains(key) || !lang.equals(iso3(g.getTrackFormat(i).language))) continue;
                syncTried.add(key);
                subDelayMs = 0;
                if (cueRenderer != null) cueRenderer.delayUs = 0;
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), i)).build());
                return true;
            }
        }
        return false;
    }
    /** "Zamanlama": how much later (ms; negative = earlier) the subtitles show, for this video */
    private long subDelayMs;

    private static String delayText(long ms) {
        if (ms == 0) return "Videoyla aynı";
        return String.format(new Locale("tr"), "%+.1f sn", ms / 1000.0).replace('.', ',') + (ms > 0 ? " (geç)" : " (erken)");
    }

    /** Subtitle timing: steps of 0.1 and 0.5 s; the change shows at once and Back returns. */
    private void delayDialog(String focusKey) {
        LinearLayout list = openPanel("Altyazı zamanlaması", delayText(subDelayMs));
        backTo = this::tracksDialog;
        String[] labels = { "0,5 sn geç göster", "0,1 sn geç göster", "0,1 sn erken göster", "0,5 sn erken göster", "Sıfırla" };
        long[] steps = { 500, 100, -100, -500, 0 };
        View cur = null;
        View auto = panelRow("Otomatik eşitle", "Videonun sesine göre, buranın çevresinden", false, v -> { closeEpisodes(); runAutoSync(false); });
        list.addView(auto);
        if ("auto".equals(focusKey)) cur = auto;
        for (int i = 0; i < labels.length; i++) {
            final long st = steps[i];
            final String key = String.valueOf(i);
            View r = panelRow(labels[i], i == 0 ? "Altyazı konuşmadan önce geliyorsa" : i == 3 ? "Altyazı konuşmadan sonra geliyorsa" : null, false, v -> {
                subDelayMs = st == 0 ? 0 : subDelayMs + st;
                if (cueRenderer != null) cueRenderer.delayUs = subDelayMs * 1000;
                delayDialog(key);
            });
            list.addView(r);
            if (key.equals(focusKey)) cur = r;
        }
        focusPanel(cur);
    }
    private List<androidx.media3.common.text.Cue> cuesNow = new ArrayList<>();
    /** Lines met ahead of time (text, start), for when the AI translation is switched on later. */
    private final List<Object[]> aheadLines = new java.util.concurrent.CopyOnWriteArrayList<>();
    /** Lines waiting for the AI, the one on screen first, then the soonest. */
    private final java.util.concurrent.PriorityBlockingQueue<Object[]> lineQueue =
        new java.util.concurrent.PriorityBlockingQueue<>(64, (x, y) -> Long.compare((long) x[1], (long) y[1]));
    private final java.util.Set<String> queued = java.util.concurrent.ConcurrentHashMap.newKeySet();

    private final CueRenderer.Listener cueListener = new CueRenderer.Listener() {
        @Override public void ahead(androidx.media3.extractor.text.CuesWithTiming c) {
            for (androidx.media3.common.text.Cue q : c.cues) {
                if (q.text == null) continue;
                String en = norm(q.text.toString());
                if (en.isEmpty()) continue;
                aheadLines.add(new Object[] { en, c.startTimeUs });
                if (tozLive) queueLine(en, c.startTimeUs);
            }
        }
        @Override public void show(List<androidx.media3.common.text.Cue> cues) {
            cuesNow = cues;
            refreshCues();
        }
    };

    /** Into the AI's queue (once per line); one worker step per line, taking the most urgent line then. */
    private void queueLine(String en, long startUs) {
        if (tozCache.containsKey(en) || !queued.add(en)) return;
        lineQueue.add(new Object[] { en, startUs });
        tozExec.execute(this::translateNext);
    }

    private void translateNext() {
        Object[] it;
        long now = cueRenderer != null ? cueRenderer.now : 0;
        // lines already past are dropped (a seek forward); the one on screen has start = MIN
        while ((it = lineQueue.poll()) != null && (long) it[1] != Long.MIN_VALUE && (long) it[1] < now - 8_000_000) queued.remove((String) it[0]);
        if (it == null || !tozLive) return;
        String en = (String) it[0];
        queued.remove(en);
        if (tozCache.containsKey(en)) return;
        String tr = null;
        try { tr = tozLine(en); } catch (Throwable e) { /* the line stays English-less: nothing shows */ }
        if (tr == null || tr.isEmpty()) return;
        final String out = tr;
        ui.post(() -> { tozCache.put(en, out); refreshCues(); });
    }

    /**
     * The lines on screen into the subtitle view: as they are, or (AI on) each one in Turkish, kept where the
     * file places it. A line not translated yet is asked for first and shows when ready, never in English.
     */
    private void refreshCues() {
        androidx.media3.ui.SubtitleView sv = view != null ? view.getSubtitleView() : null;
        if (sv == null) return;
        if (!tozLive) {
            List<androidx.media3.common.text.Cue> l = new ArrayList<>();
            for (androidx.media3.common.text.Cue q : cuesNow) l.add(place(q));
            sv.setCues(l);
            return;
        }
        List<androidx.media3.common.text.Cue> l = new ArrayList<>();
        for (androidx.media3.common.text.Cue q : cuesNow) {
            if (q.text == null) { l.add(q); continue; }
            q = place(q);
            String en = norm(q.text.toString());
            if (en.isEmpty()) continue;
            String tr = tozCache.get(en);
            if (tr != null) l.add(q.buildUpon().setText(tr).build());
            else if (!queued.contains(en)) {
                queued.add(en);
                lineQueue.add(new Object[] { en, Long.MIN_VALUE });
                tozExec.execute(this::translateNext);
            }
        }
        sv.setCues(l);
    }

    void finishWithResult() {
        Intent r = new Intent();
        if (player != null) {
            r.putExtra("position", player.getCurrentPosition());
            r.putExtra("duration", player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration());
        }
        r.putExtra("action", action);
        setResult(RESULT_OK, r);
        finish();
    }

    @Override public void onBackPressed() {
        if (epPanel != null) { closeEpisodes(); return; }
        if (locked) { lockOverlay.setVisibility(View.VISIBLE); return; }
        finishWithResult();
    }

    @Override protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override protected void onDestroy() {
        if (current == this) current = null;
        pending = null;
        keepPage = false;
        tozExec.shutdownNow();
        thumbExec.shutdownNow();
        ui.removeCallbacksAndMessages(null);
        if (player != null) player.release();
        player = null;
        super.onDestroy();
    }
}
