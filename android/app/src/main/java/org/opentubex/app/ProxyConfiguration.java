package org.opentubex.app;

import java.net.IDN;
import java.util.Arrays;
import java.util.Objects;

/** Immutable routing policy. An invalid enabled configuration blocks networking. */
final class ProxyConfiguration {
    final boolean enabled;
    final String protocol, hostname, username, password;
    final int port;

    ProxyConfiguration(boolean enabled, String protocol, String hostname, String port,
                       String username, String password) {
        this.enabled = enabled;
        this.protocol = protocol;
        this.hostname = hostname;
        this.username = username;
        this.password = password;
        int parsed;
        try { parsed = Integer.parseInt(port); } catch (NumberFormatException error) { parsed = 0; }
        this.port = parsed;
    }

    @Override public boolean equals(Object other) {
        if (!(other instanceof ProxyConfiguration value)) return false;
        return enabled == value.enabled && port == value.port &&
            protocol.equals(value.protocol) && hostname.equals(value.hostname) &&
            username.equals(value.username) && password.equals(value.password);
    }

    @Override public int hashCode() {
        return Objects.hash(enabled, protocol, hostname, port, username, password);
    }

    void validate() {
        if (!enabled) return;
        if (!Arrays.asList("http", "https", "socks4", "socks5").contains(protocol) ||
            hostname.trim().isEmpty() || hostname.matches(".*[\\s/@?#\\\\].*") ||
            port < 1 || port > 65535 || username.indexOf('\0') >= 0 || password.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("Invalid proxy configuration");
        }
        if (!hostname.contains(":")) IDN.toASCII(hostname);
    }
}
