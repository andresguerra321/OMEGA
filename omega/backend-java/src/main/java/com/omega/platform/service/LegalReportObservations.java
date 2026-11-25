package com.omega.platform.service;

import com.omega.platform.domain.DocumentChunkEntity;
import java.util.*;
import java.util.regex.Pattern;

/** Literal passages for review, not inferred legal conclusions. No external AI call or credit charge. */
public final class LegalReportObservations {
    private LegalReportObservations() {}
    private static final Pattern OBLIGATION=Pattern.compile("(?iuU)\\b(deber[aá]n?|se obliga|se compromete|obligaci[oó]n|obligaciones)\\b");
    private static final Pattern AMOUNT=Pattern.compile("(?iuU)(?:\\$\\s*\\d|\\b(?:COP|USD|EUR)\\s*\\d|\\b\\d[\\d.,]*\\s+(?:pesos|d[oó]lares|euros)\\b)");
    public record Observation(String category,UUID documentId,UUID chunkId,int pageNumber,String excerpt,String reviewStatus) {}
    public record Result(int chunksReviewed,int candidatesFound,boolean truncated,List<Observation> observations) {}
    public static Result extract(List<DocumentChunkEntity> chunks) {
        var observations=new ArrayList<Observation>();
        int found=0;
        for(var chunk:chunks) {
            String content=chunk.getContent();
            if(content==null || chunk.getPageNumber()<1) continue;
            for(String passage:content.split("(?<=[.;!?])\\s+|\\R+")) {
                String text=passage.trim();
                String category=OBLIGATION.matcher(text).find()?"POSIBLE_OBLIGACION":AMOUNT.matcher(text).find()?"MENCION_MONETARIA":null;
                if(category==null) continue;
                found++;
                if(observations.size()<200) observations.add(new Observation(category,chunk.getDocumentId(),chunk.getId(),chunk.getPageNumber(),
                    text.length()>700?text.substring(0,700)+" [extracto abreviado; consulte el fragmento completo]":text,"PENDING_REVIEW"));
            }
        }
        return new Result(chunks.size(),found,found>observations.size(),List.copyOf(observations));
    }
}
