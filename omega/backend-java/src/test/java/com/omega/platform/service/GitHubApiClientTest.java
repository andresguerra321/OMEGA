package com.omega.platform.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class GitHubApiClientTest {
    @Test
    void rejectsRepositoryPathsThatCouldChangeTheRequestTarget() {
        var client = new GitHubApiClient.DefaultGitHubApiClient("", "", "omega[bot]");
        for (String repo : List.of("../repo", "owner/..", "owner/repo/extra", "owner/repo?query=1")) {
            assertThrows(IllegalArgumentException.class, () -> client.listPullRequestFiles("token", repo, 1));
            assertThrows(IllegalArgumentException.class, () -> client.downloadTarballBounded("token", repo, "sha", 100));
        }
    }

    @Test
    void repositoryOwnerAndNameRemainSeparatePathSegments() {
        var builder = RestClient.builder().baseUrl("https://api.github.com");
        var server = MockRestServiceServer.bindTo(builder).build();
        var client = new GitHubApiClient.DefaultGitHubApiClient("", "", "omega[bot]");
        ReflectionTestUtils.setField(client, "restClient", builder.build());

        server.expect(requestTo("https://api.github.com/repos/owner/repo/pulls/1/files?per_page=100"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("[{\"filename\":\"package.json\"}]", MediaType.APPLICATION_JSON));
        assertEquals(List.of("package.json"), client.listPullRequestFiles("token", "owner/repo", 1));
        server.verify();
    }

    @Test
    void createsThenUpdatesTheBotsExistingComment() {
        var builder = RestClient.builder().baseUrl("https://api.github.com");
        var server = MockRestServiceServer.bindTo(builder).build();
        var client = new GitHubApiClient.DefaultGitHubApiClient("", "", "omega[bot]");
        ReflectionTestUtils.setField(client, "restClient", builder.build());
        String marker = "<!-- omega-scan-pr -->";
        String commentsUrl = "https://api.github.com/repos/owner/repo/issues/1/comments";

        server.expect(requestTo(commentsUrl + "?per_page=100"))
                .andRespond(withSuccess("[]", MediaType.APPLICATION_JSON));
        server.expect(requestTo(commentsUrl)).andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        client.upsertPullRequestComment("token", "owner/repo", 1, marker, marker + " first");
        server.verify();
        server.reset();

        server.expect(requestTo(commentsUrl + "?per_page=100"))
                .andRespond(withSuccess("[{\"id\":42,\"body\":\"" + marker
                        + " first\",\"user\":{\"login\":\"omega[bot]\",\"type\":\"Bot\"}}]", MediaType.APPLICATION_JSON));
        server.expect(requestTo("https://api.github.com/repos/owner/repo/issues/comments/42"))
                .andExpect(method(HttpMethod.PATCH))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        client.upsertPullRequestComment("token", "owner/repo", 1, marker, marker + " updated");
        server.verify();
    }
}
