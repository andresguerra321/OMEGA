package com.omega.platform.ingest;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.omega.platform.config.OmegaProperties;
import com.omega.platform.integration.forensic.ArchiveSecurityValidator;
import java.nio.file.*;
import java.util.Arrays;
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

        // JPEG válido
        Path jpeg=directory.resolve("synthetic.jpg");
        javax.imageio.ImageIO.write(new BufferedImage(64,64,BufferedImage.TYPE_INT_RGB),"jpeg",jpeg.toFile());
        assertThat(extractor.inspect(jpeg).format()).isEqualTo("IMAGE");
        assertThat(extractor.extract(jpeg,"IMAGE").chunks().getFirst().content()).contains("Texto OCR sintético");
    }

    @Test void rejectsHostileDocxMacrosZipBombsAndForgedExtensions() throws Exception {
        var extractor=extractor();
        String validXml="<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Texto sintético.</w:t></w:r></w:p></w:body></w:document>";

        // 1. DOCX con macro VBA (vbaProject.bin)
        Path macroDocx=directory.resolve("hostile-macro.docx");
        try(var zip=new ZipOutputStream(Files.newOutputStream(macroDocx))) {
            zip.putNextEntry(new ZipEntry("word/document.xml")); zip.write(validXml.getBytes(java.nio.charset.StandardCharsets.UTF_8)); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("word/vbaProject.bin")); zip.write(new byte[]{1,2,3,4}); zip.closeEntry();
        }
        assertThatThrownBy(() -> extractor.inspect(macroDocx))
                .isInstanceOf(InvalidDocumentException.class)
                .hasMessageContaining("elementos activos");

        // 2. DOCX zip bomb (contenido XML altamente comprimido > 8 MB descomprimido)
        Path bombDocx=directory.resolve("hostile-bomb.docx");
        try(var zip=new ZipOutputStream(Files.newOutputStream(bombDocx))) {
            zip.putNextEntry(new ZipEntry("word/document.xml"));
            byte[] zeros=new byte[1024*1024];
            Arrays.fill(zeros,(byte)'A');
            for(int i=0;i<9;i++) zip.write(zeros);
            zip.closeEntry();
        }
        assertThatThrownBy(() -> extractor.inspect(bombDocx))
                .isInstanceOf(InvalidDocumentException.class);

        // 3. Extensión .docx / .png falsa (sin firma binaria válida)
        Path forged=directory.resolve("forged.docx");
        Files.writeString(forged,"<html><script>alert(1)</script></html>");
        assertThatThrownBy(() -> extractor.inspect(forged))
                .isInstanceOf(InvalidDocumentException.class);
    }
}
