package org.opentubex.app;

import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;

public class NativeAudioSpectrumTest {
    @Test public void decodedToneProducesTheExpectedFrequencyWithoutConsumingAudio() {
        NativeAudioSpectrum spectrum = new NativeAudioSpectrum();
        ByteBuffer audio = ByteBuffer.allocate(512).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 256; i++) audio.putShort((short) (1000 * Math.sin(2 * Math.PI * 10 * i / 256)));
        audio.flip();
        spectrum.append(audio, 1);
        assertEquals(0, audio.position());
        int[] bins = spectrum.snapshot();
        int peak = 0;
        for (int i = 1; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
        assertEquals(10, peak);
        assertTrue(bins[peak] > 0);
    }

    @Test public void resetRemovesThePreviousSourcesSpectrum() {
        NativeAudioSpectrum spectrum = new NativeAudioSpectrum();
        ByteBuffer audio = ByteBuffer.allocate(512).order(ByteOrder.LITTLE_ENDIAN);
        while (audio.hasRemaining()) audio.putShort((short) 16000);
        audio.flip();
        spectrum.append(audio, 1);
        spectrum.reset();
        for (int bin : spectrum.snapshot()) assertEquals(0, bin);
    }
}
