package org.opentubex.app;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** A small copy of decoded audio for visualization, without microphone access. */
final class NativeAudioSpectrum {
    private static final int SIZE = 256;
    private final double[] samples = new double[SIZE];
    private int next;

    synchronized void reset() {
        java.util.Arrays.fill(samples, 0);
        next = 0;
    }

    synchronized void append(ByteBuffer input, int channels) {
        if (channels <= 0) return;
        ByteBuffer buffer = input.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        // Only the latest window is needed; do not copy the whole decoded buffer.
        int frames = buffer.remaining() / (channels * 2);
        buffer.position(buffer.position() + Math.max(0, frames - SIZE) * channels * 2);
        while (buffer.remaining() >= channels * 2) {
            double sample = 0;
            for (int channel = 0; channel < channels; channel++) sample += buffer.getShort() / 32768.0;
            samples[next] = sample / channels;
            next = (next + 1) % SIZE;
        }
    }

    int[] snapshot() {
        double[] window = new double[SIZE];
        synchronized (this) {
            for (int i = 0; i < SIZE; i++) {
                window[i] = samples[(next + i) % SIZE] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE));
            }
        }
        int[] bins = new int[SIZE / 2];
        for (int bin = 0; bin < bins.length; bin++) {
            double real = 0;
            double imaginary = 0;
            for (int i = 0; i < SIZE; i++) {
                double phase = 2 * Math.PI * bin * i / SIZE;
                real += window[i] * Math.cos(phase);
                imaginary -= window[i] * Math.sin(phase);
            }
            double magnitude = Math.hypot(real, imaginary) / SIZE;
            double decibels = 20 * Math.log10(Math.max(1e-8, magnitude));
            bins[bin] = (int) Math.max(0, Math.min(255, (decibels + 100) / 70 * 255));
        }
        return bins;
    }
}
