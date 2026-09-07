package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import java.io.*;
import java.util.List;
import static org.junit.Assert.*;

public class YtDlpRuntimeTest {
    @Test public void bundledRuntimeDownloadsAndConvertsAudioWithoutNetwork() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context testContext = InstrumentationRegistry.getInstrumentation().getContext();
        File directory = new File(context.getCacheDir(), "yt-dlp-runtime-test");
        directory.mkdirs();
        File fixture = new File(directory, "demo.webm");
        try {
            try (InputStream input = testContext.getAssets().open("demo.webm")) {
                YtDlpFiles.write(fixture, YtDlpFiles.read(input, 1024 * 1024));
            }
            assertFalse(YtDlpRuntime.ffmpegVersion(context, "ffmpeg").isEmpty());
            assertFalse(YtDlpRuntime.ffmpegVersion(context, "ffprobe").isEmpty());
            assertTrue(YtDlpRuntime.extract(context, asList("--version")).matches("[0-9].*"));
            String metadata = YtDlpRuntime.extract(context, asList("--enable-file-urls", "--dump-single-json", fixture.toURI().toString()));
            assertTrue(metadata.contains("demo"));
            YtDlpRuntime.execute(context, asList("--enable-file-urls", "--extract-audio", "--audio-format", "mp3", "--output",
                new File(directory, "converted.%(ext)s").getAbsolutePath(), fixture.toURI().toString()), "runtime-test", null);
            assertTrue(new File(directory, "converted.mp3").length() > 0);
        } finally { YtDlpFiles.deleteTree(directory); }
    }

    @Test public void cancellationAlsoStopsPostprocessorChildren() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context testContext = InstrumentationRegistry.getInstrumentation().getContext();
        File directory = new File(context.getCacheDir(), "yt-dlp-cancel-test");
        directory.mkdirs();
        File fixture = new File(directory, "demo.webm");
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        try (InputStream input = testContext.getAssets().open("demo.webm")) {
            YtDlpFiles.write(fixture, YtDlpFiles.read(input, 1024 * 1024));
        }
        Thread download = new Thread(() -> {
            try {
                YtDlpRuntime.execute(context, asList("--enable-file-urls", "--output",
                    new File(directory, "copy.%(ext)s").getAbsolutePath(), "--extract-audio", "--audio-format", "mp3",
                    "--postprocessor-args", "ExtractAudio+ffmpeg_i:-re",
                    fixture.toURI().toString()), "download-987654321", null);
            } catch (Exception error) { failure.set(error); }
        });
        try {
            download.start();
            long deadline = System.currentTimeMillis() + 15000;
            int pid = 0;
            while (pid == 0 && download.isAlive() && System.currentTimeMillis() < deadline) {
                for (File process : new File("/proc").listFiles()) {
                    try {
                        if (android.system.Os.readlink(new File(process, "exe").getPath()).endsWith("/libffmpeg.so") &&
                            new String(YtDlpFiles.readFile(new File(process, "cmdline"))).contains(directory.getAbsolutePath())) {
                            pid = Integer.parseInt(process.getName());
                            break;
                        }
                    } catch (Exception ignored) { }
                }
                if (pid == 0) Thread.sleep(20);
            }
            assertTrue("Postprocessor did not start: " + failure.get(), pid > 0);
            YtDlpRuntime.cancel(987654321);
            download.join(5000);
            assertFalse("Cancellation left the download running", download.isAlive());
            boolean alive = true;
            deadline = System.currentTimeMillis() + 3000;
            while (alive && System.currentTimeMillis() < deadline) {
                try { android.system.Os.kill(pid, 0); Thread.sleep(50); }
                catch (android.system.ErrnoException gone) { alive = false; }
            }
            assertFalse("Cancellation left a postprocessor running", alive);
        } finally {
            YtDlpRuntime.cancel(987654321);
            download.interrupt();
            download.join(5000);
            YtDlpFiles.deleteTree(directory);
        }
    }
}
