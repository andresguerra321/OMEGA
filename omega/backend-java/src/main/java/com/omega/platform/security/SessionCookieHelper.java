package com.omega.platform.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * Emite y limpia cookies de sesión HttpOnly + SameSite=Strict para navegadores
 * web, eliminando la necesidad de persistir tokens JWT en localStorage.
 */
@Component
public class SessionCookieHelper {

    private final String cookieName;
    private final boolean forceSecureCookie;
    private final long maxAgeSeconds;

    public SessionCookieHelper(
            @Value("${omega.security.session-cookie-name:omega_session}") String cookieName,
            @Value("${omega.security.session-cookie-secure:false}") boolean forceSecureCookie,
            @Value("${omega.security.jwt-expiration-seconds:3600}") long maxAgeSeconds) {
        this.cookieName = (cookieName == null || cookieName.isBlank()) ? "omega_session" : cookieName.trim();
        this.forceSecureCookie = forceSecureCookie;
        this.maxAgeSeconds = Math.max(60L, maxAgeSeconds);
    }

    public String extractSessionToken(HttpServletRequest request) {
        if (request == null || request.getCookies() == null) {
            return null;
        }
        for (Cookie cookie : request.getCookies()) {
            if (cookieName.equals(cookie.getName())) {
                String value = cookie.getValue();
                if (value != null && !value.isBlank()) {
                    return value.trim();
                }
            }
        }
        return null;
    }

    public void attachSessionCookie(
            HttpServletRequest request,
            HttpServletResponse response,
            String jwtToken) {
        if (jwtToken == null || jwtToken.isBlank() || JwtAuthenticationFilter.isBearerOnlyRequest(request)) {
            return;
        }
        ResponseCookie cookie = ResponseCookie.from(cookieName, jwtToken.trim())
                .httpOnly(true)
                .secure(shouldMarkSecure(request))
                .sameSite("Strict")
                .path("/api")
                .maxAge(maxAgeSeconds)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public void clearSessionCookie(HttpServletRequest request, HttpServletResponse response) {
        ResponseCookie expired = ResponseCookie.from(cookieName, "")
                .httpOnly(true)
                .secure(shouldMarkSecure(request))
                .sameSite("Strict")
                .path("/api")
                .maxAge(0)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, expired.toString());
    }

    public String getCookieName() {
        return cookieName;
    }

    private boolean shouldMarkSecure(HttpServletRequest request) {
        if (forceSecureCookie) {
            return true;
        }
        if (request == null) {
            return false;
        }
        String forwardedProto = request.getHeader("X-Forwarded-Proto");
        return request.isSecure() || "https".equalsIgnoreCase(forwardedProto);
    }
}
