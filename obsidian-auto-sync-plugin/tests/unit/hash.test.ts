import { describe, it, expect } from '@jest/globals';
import * as crypto from 'crypto-js';

describe('Hash Generation', () => {
  const generateHash = (content: string): string => {
    return crypto.SHA256(content).toString();
  };

  describe('Basic Hash Generation', () => {
    it('should generate hash for simple text', () => {
      const content = 'Hello, World!';
      const hash = generateHash(content);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA256 produces 64 character hex string
    });

    it('should generate hash for empty string', () => {
      const hash = generateHash('');
      
      expect(hash).toBeDefined();
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should generate hash for large content', () => {
      const largeContent = 'A'.repeat(10000);
      const hash = generateHash(largeContent);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });
  });

  describe('Hash Consistency', () => {
    it('should generate same hash for identical content', () => {
      const content = 'Consistent content for testing';
      const hash1 = generateHash(content);
      const hash2 = generateHash(content);
      
      expect(hash1).toBe(hash2);
    });

    it('should generate same hash multiple times', () => {
      const content = 'Multiple hash generation test';
      const hashes = Array.from({ length: 10 }, () => generateHash(content));
      
      const firstHash = hashes[0];
      hashes.forEach(hash => {
        expect(hash).toBe(firstHash);
      });
    });
  });

  describe('Hash Uniqueness', () => {
    it('should generate different hashes for different content', () => {
      const content1 = 'First content';
      const content2 = 'Second content';
      
      const hash1 = generateHash(content1);
      const hash2 = generateHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should be sensitive to small changes', () => {
      const content1 = 'This is a test content.';
      const content2 = 'This is a test content!'; // Only punctuation change
      
      const hash1 = generateHash(content1);
      const hash2 = generateHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should be sensitive to whitespace changes', () => {
      const content1 = 'content with spaces';
      const content2 = 'content with  spaces'; // Extra space
      
      const hash1 = generateHash(content1);
      const hash2 = generateHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should be sensitive to case changes', () => {
      const content1 = 'case sensitive content';
      const content2 = 'Case Sensitive Content';
      
      const hash1 = generateHash(content1);
      const hash2 = generateHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Special Characters and Encoding', () => {
    it('should handle unicode characters', () => {
      const content = '🚀 Unicode content with emojis  テスト';
      const hash = generateHash(content);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it('should handle special markdown characters', () => {
      const content = '# Header\n\n**Bold** and *italic* text\n\n- List item\n- Another item\n\n```javascript\nconsole.log("code");\n```';
      const hash = generateHash(content);
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });

    it('should handle newlines and tabs', () => {
      const content1 = 'Line 1\nLine 2\tTabbed content';
      const content2 = 'Line 1\nLine 2\tTabbed content';
      const content3 = 'Line 1 Line 2 Tabbed content';
      
      const hash1 = generateHash(content1);
      const hash2 = generateHash(content2);
      const hash3 = generateHash(content3);
      
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('Hash Performance', () => {
    it('should handle large files efficiently', () => {
      const largeContent = Array.from({ length: 1000 }, (_, i) => 
        `This is line ${i + 1} of a large file content for testing hash generation performance.\n`
      ).join('');
      
      const startTime = Date.now();
      const hash = generateHash(largeContent);
      const endTime = Date.now();
      
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should be deterministic across multiple runs', () => {
      const content = 'Deterministic hash test content';
      const hashes = [];
      
      for (let i = 0; i < 100; i++) {
        hashes.push(generateHash(content));
      }
      
      const firstHash = hashes[0];
      hashes.forEach(hash => {
        expect(hash).toBe(firstHash);
      });
    });
  });

  describe('Conflict Detection Scenarios', () => {
    it('should detect when file content has changed', () => {
      const originalContent = 'Original file content';
      const modifiedContent = 'Modified file content';
      
      const originalHash = generateHash(originalContent);
      const modifiedHash = generateHash(modifiedContent);
      
      expect(originalHash).not.toBe(modifiedHash);
    });

    it('should detect subtle changes in content', () => {
      const content1 = 'This is the original content.';
      const content2 = 'This is the original content '; // Trailing space added
      
      const hash1 = generateHash(content1);
      const hash2 = generateHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should confirm when content is identical', () => {
      const content = 'Identical content for testing';
      const hash1 = generateHash(content);
      const hash2 = generateHash(content);
      
      expect(hash1).toBe(hash2);
      
      // Simulate file sync verification
      const isContentIdentical = hash1 === hash2;
      expect(isContentIdentical).toBe(true);
    });
  });
});