package com.omega.platform.ingest;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.integration.forensic.ArchiveSecurityValidator;
import java.nio.file.*;
import java.util.zip.*;
import java.io.*;
import java.awt.image.BufferedImage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OfficeImageExtractorTest {
    @TempDir Path directory;
    private OfficeImageExtractor extractor() {
        var properties=mock(OmegaProperties.class); var rag=mock(OmegaProperties.Rag.class); var ocr=mock(OcrExtractor.class);
        when(properties.rag()).thenReturn(rag); when(rag.minChunkTokens()).thenReturn(500); when(rag.maxChunkTokens()).thenReturn(1000);
        when(properties.ingest()).thenReturn(new OmegaProperties.Ingest(directory.toString(),25*1024*1024,directory.toString()));
        when(ocr.extractText(any())).thenReturn("Texto OCR sintético para verificar la extracción sin documentos de clientes.");
        return new OfficeImageExtractor(new ArchiveSecurityValidator(),ocr,new PdfChunkExtractor(ocr,properties),properties);
    }
    private Path word(String xml,String relationships) throws Exception {
        Path path=directory.resolve(java.util.UUID.randomUUID()+".docx");
        try(var zip=new ZipOutputStream(Files.newOutputStream(path))) {
            zip.putNextEntry(new ZipEntry("word/document.xml")); zip.write(xml.getBytes(java.nio.charset.StandardCharsets.UTF_8)); zip.closeEntry();
            if(relationships!=null) { zip.putNextEntry(new ZipEntry("word/_rels/document.xml.rels")); zip.write(relationships.getBytes(java.nio.charset.StandardCharsets.UTF_8)); zip.closeEntry(); }
        }
        return path;
    }
    @Test void extractsWordTextAsSegmentsAndRejectsExternalXmlAndRelationships() throws Exception {
        String xml="<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Contrato sintético con fecha y monto de prueba.</w:t></w:r></w:p></w:body></w:document>";
        var extractor=extractor(); Path path=word(xml,null);
        assertThat(extractor.inspect(path).format()).isEqualTo("DOCX");
        var result=extractor.extract(path,"DOCX");
        assertThat(result.chunks()).hasSize(1); assertThat(result.chunks().getFirst().content()).contains("Contrato sintético");
        assertThat(result.chunks().getFirst().sectionTitle()).contains("sin paginación fija");
        Path xxe=word("<!DOCTYPE x [<!ENTITY ext SYSTEM 'file:///synthetic'>]>"+xml,null);
        assertThatThrownBy(() -> extractor.inspect(xxe)).isInstanceOf(InvalidDocumentException.class);
        Path external=word(xml,"<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship TargetMode=\"External\" Target=\"https://example.invalid\" Id=\"r1\"/></Relationships>");
        assertThatThrownBy(() -> extractor.inspect(external)).isInstanceOf(InvalidDocumentException.class);
    }
    @Test void extractsPngWithExistingOcrAdapterAndRejectsOversizedDimensions() throws Exception {
        Path image=directory.resolve("synthetic.png");
        javax.imageio.ImageIO.write(new BufferedImage(64,64,BufferedImage.TYPE_INT_RGB),"png",image.toFile());
        var extractor=extractor(); assertThat(extractor.inspect(image).format()).isEqualTo("IMAGE");
        assertThat(extractor.extract(image,"IMAGE").chunks().getFirst().content()).contains("Texto OCR sintético");
        javax.imageio.ImageIO.write(new BufferedImage(4097,1,BufferedImage.TYPE_INT_RGB),"png",image.toFile());
        assertThatThrownBy(() -> extractor.inspect(image)).isInstanceOf(InvalidDocumentException.class);
    }
}
