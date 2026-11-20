package com.omega.platform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omega.platform.domain.TenantProfile;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

/**
 * Carga la definición versionada de configuración por perfil desde {@code profile-configs.json}.
 */
@Service
public class TenantProfileConfigService {

    public record ProfileConfig(
            TenantProfile profile,
            List<String> visibleModules,
            String ragCorpusScope,
            String copilotTone,
            String copilotInstructions,
            String defaultView,
            String configVersion
    ) {
    }

    private final Map<TenantProfile, ProfileConfig> configs = new EnumMap<>(TenantProfile.class);

    public TenantProfileConfigService(ObjectMapper objectMapper) {
        loadFromClasspath(objectMapper);
    }

    public ProfileConfig getConfig(TenantProfile profile) {
        TenantProfile key = profile != null ? profile : TenantProfile.GENERAL;
        return configs.getOrDefault(key, configs.get(TenantProfile.GENERAL));
    }

    private void loadFromClasspath(ObjectMapper objectMapper) {
        ClassPathResource resource = new ClassPathResource("profile-configs.json");
        try (InputStream in = resource.getInputStream()) {
            JsonNode root = objectMapper.readTree(in);
            String version = root.path("version").asText("1.0.0");
            JsonNode profilesNode = root.path("profiles");
            for (TenantProfile p : TenantProfile.values()) {
                JsonNode node = profilesNode.path(p.name());
                List<String> modules = new ArrayList<>();
                node.path("visibleModules").forEach(m -> modules.add(m.asText()));
                configs.put(
                        p,
                        new ProfileConfig(
                                p,
                                List.copyOf(modules),
                                node.path("ragCorpusScope").asText("general_cti"),
                                node.path("copilotTone").asText("balanced_defensive"),
                                node.path("copilotInstructions").asText(""),
                                node.path("defaultView").asText("inicio"),
                                version));
            }
        } catch (IOException ex) {
            throw new IllegalStateException("No se pudo cargar profile-configs.json", ex);
        }
    }
}
