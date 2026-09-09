package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Consumer;

/** Bundled executables stay in nativeLibraryDir, as required by Android's W^X policy. */
final class YtDlpRuntime {
    private static final ExecutorService EXTRACTORS = Executors.newFixedThreadPool(2);
    private static final ReentrantReadWriteLock INSTALL_LOCK = new ReentrantReadWriteLock();
    private static final Map<String, RunningProcess> PROCESSES = new ConcurrentHashMap<>();
    private static boolean initialized;

    private static final class RunningProcess {
        final Process process;
        final AtomicInteger group = new AtomicInteger();
        volatile boolean stopped;
        RunningProcess(Process process) { this.process = process; }
        void stop() {
            // Python creates its own session before importing yt-dlp. Its FFmpeg children
            // belong to this group, so cancellation also stops merging and conversion.
            stopped = true;
            int pid = group.get();
            if (pid > 0) {
                try { android.system.Os.kill(-pid, android.system.OsConstants.SIGKILL); }
                catch (android.system.ErrnoException ignored) { /* Already exited. */ }
            }
            process.destroy();
        }
    }

    static synchronized void initialize(Context context) throws Exception {
        if (initialized) return;
        YoutubeDL.getInstance().init(context);
        FFmpeg.getInstance().init(context);
        initialized = true;
    }

    private static ProcessBuilder command(Context context, List<String> args) {
        ProcessBuilder builder = new ProcessBuilder(args);
        File packages = new File(context.getNoBackupFilesDir(), "youtubedl-android/packages");
        String python = new File(packages, "python/usr").getAbsolutePath();
        builder.environment().put("LD_LIBRARY_PATH", python + "/lib:" + new File(packages, "ffmpeg/usr/lib").getAbsolutePath());
        builder.environment().put("SSL_CERT_FILE", python + "/etc/tls/cert.pem");
        builder.environment().put("PYTHONHOME", python);
        builder.environment().put("HOME", context.getNoBackupFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", context.getCacheDir().getAbsolutePath());
        builder.environment().put("PATH", System.getenv("PATH") + ":" + context.getApplicationInfo().nativeLibraryDir);
        // Also covers FFmpeg and any HTTP clients spawned by yt-dlp.
        builder.environment().put("http_proxy", AndroidProxy.url());
        builder.environment().put("https_proxy", AndroidProxy.url());
        builder.environment().put("all_proxy", AndroidProxy.url());
        builder.environment().put("no_proxy", "");
        builder.environment().put("NO_PROXY", "");
        return builder;
    }

    static String execute(Context context, List<String> args, String id, Consumer<String> progress) throws Exception {
        initialize(context);
        INSTALL_LOCK.readLock().lockInterruptibly();
        RunningProcess running = null;
        boolean completed = false;
        try {
            String nativeDir = context.getApplicationInfo().nativeLibraryDir;
            String marker = "__OPENTUBEX_PROCESS_" + UUID.randomUUID() + "__:";
            String bootstrap = "import os,sys,runpy\nos.setsid()\nprint('" + marker + "'+str(os.getpid()),flush=True)\nsys.argv=sys.argv[1:]\nrunpy.run_path(sys.argv[0],run_name='__main__')";
            List<String> command = new ArrayList<>(asList(nativeDir + "/libpython.so", "-u", "-c", bootstrap,
                new File(context.getNoBackupFilesDir(), "youtubedl-android/yt-dlp/yt-dlp").getAbsolutePath(),
                "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--js-runtimes", "quickjs:" + nativeDir + "/libqjs.so",
                "--ffmpeg-location", nativeDir + "/libffmpeg.so"));
            command.addAll(args);
            // Last option wins over custom arguments; --geo-verification-proxy must
            // follow the same policy instead of escaping through a second proxy.
            command.addAll(asList("--proxy", AndroidProxy.url(), "--geo-verification-proxy", AndroidProxy.url()));
            running = new RunningProcess(command(context, command).start());
            RunningProcess current = running;
            if (id != null) PROCESSES.put(id, current);
            StringBuilder output = new StringBuilder(), errors = new StringBuilder();
            FutureTask<Void> stdout = new FutureTask<>(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(current.process.getInputStream(), StandardCharsets.UTF_8))) {
                    String first = reader.readLine();
                    if (first == null || !first.startsWith(marker)) throw new IOException("Unable to start yt-dlp process group");
                    current.group.set(Integer.parseInt(first.substring(marker.length())));
                    if (current.stopped) current.stop();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (progress != null) progress.accept(line);
                        if (progress == null || line.startsWith("__OPENTUBEX_FILE__:")) {
                            if (output.length() + line.length() > 32 * 1024 * 1024) {
                                current.stop();
                                throw new IOException("yt-dlp returned too much metadata");
                            }
                            output.append(line).append('\n');
                        }
                    }
                }
                return null;
            });
            FutureTask<Void> stderr = new FutureTask<>(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(current.process.getErrorStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        errors.append(line).append('\n');
                        if (errors.length() > 65536) errors.delete(0, errors.length() - 65536);
                    }
                }
                return null;
            });
            new Thread(stdout, "yt-dlp-output").start();
            new Thread(stderr, "yt-dlp-errors").start();
            int exit = current.process.waitFor();
            stderr.get();
            stdout.get();
            if (exit != 0) throw new IOException(errors.toString().trim());
            completed = true;
            return output.toString();
        } finally {
            if (running != null) {
                if (!completed) running.stop();
                if (id != null) PROCESSES.remove(id, running);
            }
            INSTALL_LOCK.readLock().unlock();
        }
    }

    static String extract(Context context, List<String> args) throws Exception {
        return extract(() -> execute(context, args, null, null), 60, TimeUnit.SECONDS);
    }

    static String extract(Callable<String> operation, long timeout, TimeUnit unit) throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        Future<String> future = EXTRACTORS.submit(() -> {
            started.countDown();
            return operation.call();
        });
        try {
            started.await();
            return future.get(timeout, unit).trim();
        }
        finally { future.cancel(true); }
    }

    static YoutubeDL.UpdateStatus update(Context context, String apiUrl) throws Exception {
        initialize(context);
        INSTALL_LOCK.writeLock().lockInterruptibly();
        try { return YoutubeDL.getInstance().updateYoutubeDL(context, new YoutubeDL.UpdateChannel(apiUrl)); }
        finally { INSTALL_LOCK.writeLock().unlock(); }
    }

    static String ffmpegVersion(Context context, String binary) throws Exception {
        initialize(context);
        Process process = command(context, asList(new File(context.getApplicationInfo().nativeLibraryDir, "lib" + binary + ".so").getAbsolutePath(), "-version"))
            .redirectErrorStream(true).start();
        try {
            String line;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) { line = reader.readLine(); }
            if (line == null || !line.startsWith(binary + " version ")) throw new IOException("Unable to read " + binary + " version: " + line);
            return line.split(" ")[2];
        } finally { process.destroy(); }
    }

    static void cancel(long id) {
        RunningProcess process = PROCESSES.get("download-" + id);
        if (process != null) process.stop();
    }

}
