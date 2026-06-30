/**
 * Property-Based Test: Détection correcte des bonnes pratiques Dockerfile
 *
 * Feature: capstone-cloud-resilience, Property 3: Détection correcte des bonnes pratiques Dockerfile
 * Validates: Requirements 12.3, 12.4, 12.5, 12.7
 *
 * For any randomly generated Dockerfile with a combination of best practices
 * (slim/alpine image with fixed version, non-root USER instruction, multi-stage build,
 * optimized layer order), the score computed by check-dockerfile.sh must be exactly
 * equal to the number of best practices actually present in the file.
 */

const fc = require('fast-check');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHECK_SCRIPT = path.resolve(__dirname, '../../teacher-tools/check-dockerfile.sh');

/**
 * Generate a Dockerfile content from the given configuration.
 *
 * The check-dockerfile.sh script evaluates layer order GLOBALLY across all stages:
 * - It finds the FIRST `COPY.*package` line in the whole file
 * - It finds the FIRST `RUN.*(npm install|npm ci)` line in the whole file
 * - It finds the LAST `COPY . .` line in the whole file
 * - It checks that their line numbers are in ascending order
 *
 * Therefore, in a multi-stage build, if the builder stage has COPY package*.json
 * and RUN npm ci, and the final stage has COPY . ., the layer order check will PASS
 * regardless of the final stage's own order. We must account for this.
 */
function generateDockerfile(config) {
  const lines = [];

  if (config.isMultiStage) {
    if (config.hasOptimalOrder) {
      // Multi-stage with optimal order: builder does NOT have COPY package / npm install
      // so the layer order check relies on the final stage
      lines.push('FROM node:20-alpine AS builder');
      lines.push('WORKDIR /build');
      lines.push('RUN echo "build step"');
      lines.push('');
      // Final stage with optimal order
      lines.push(`FROM ${config.baseImage}`);
      lines.push('WORKDIR /app');
      lines.push('COPY package*.json ./');
      lines.push('RUN npm install --production');
      lines.push('COPY . .');
    } else {
      // Multi-stage WITHOUT optimal order: builder has no COPY package / npm pattern
      // Final stage uses non-optimal order
      lines.push('FROM node:20-alpine AS builder');
      lines.push('WORKDIR /build');
      lines.push('RUN echo "build step"');
      lines.push('');
      // Final stage with non-optimal order (COPY . . before npm install,
      // and no COPY package*.json at all)
      lines.push(`FROM ${config.baseImage}`);
      lines.push('WORKDIR /app');
      lines.push('COPY . .');
      lines.push('RUN npm install');
    }
  } else {
    // Single stage
    lines.push(`FROM ${config.baseImage}`);
    lines.push('WORKDIR /app');

    if (config.hasOptimalOrder) {
      lines.push('COPY package*.json ./');
      lines.push('RUN npm install --production');
      lines.push('COPY . .');
    } else {
      // Non-optimal: COPY . . then npm install (no separate COPY package*.json)
      lines.push('COPY . .');
      lines.push('RUN npm install');
    }
  }

  if (config.hasUser) {
    lines.push('RUN addgroup -S appgroup && adduser -S appuser -G appgroup');
    lines.push('USER appuser');
  }

  lines.push('EXPOSE 3000');
  lines.push('CMD ["node", "main.js"]');

  return lines.join('\n') + '\n';
}

/**
 * Compute the expected score based on the configuration.
 * The script checks 5 things:
 * 1. Base image: slim/alpine with fixed version (not node:latest)
 * 2. USER instruction: non-root user present
 * 3. Multi-stage: multiple FROM instructions
 * 4. .dockerignore: exists in same directory
 * 5. Layer order: COPY package*.json before RUN npm install before COPY . .
 */
function computeExpectedScore(config) {
  let score = 0;

  // Check 1: Base image — must be slim/alpine with fixed version
  // The script checks the LAST FROM instruction
  if (config.baseImage !== 'node:latest' && /node:\d+.*-(alpine|slim)/.test(config.baseImage)) {
    score += 1;
  }

  // Check 2: USER non-root
  if (config.hasUser) {
    score += 1;
  }

  // Check 3: Multi-stage (>= 2 FROM instructions)
  if (config.isMultiStage) {
    score += 1;
  }

  // Check 4: .dockerignore exists
  if (config.hasDockerignore) {
    score += 1;
  }

  // Check 5: Layer order (COPY package*.json -> RUN npm install -> COPY . .)
  if (config.hasOptimalOrder) {
    score += 1;
  }

  return score;
}

describe('Feature: capstone-cloud-resilience, Property 3: Détection correcte des bonnes pratiques Dockerfile', () => {
  it('should compute a score exactly equal to the number of best practices present in the Dockerfile', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          baseImage: fc.oneof(
            fc.constant('node:latest'),
            fc.constant('node:20-alpine'),
            fc.constant('node:20-slim')
          ),
          hasUser: fc.boolean(),
          isMultiStage: fc.boolean(),
          hasOptimalOrder: fc.boolean(),
          hasDockerignore: fc.boolean(),
        }),
        async (config) => {
          // Create a temporary directory for the Dockerfile
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockerfile-pbt-'));
          const dockerfilePath = path.join(tmpDir, 'Dockerfile');

          try {
            // Generate and write the Dockerfile
            const content = generateDockerfile(config);
            fs.writeFileSync(dockerfilePath, content);

            // Create or skip .dockerignore
            if (config.hasDockerignore) {
              fs.writeFileSync(path.join(tmpDir, '.dockerignore'), 'node_modules\n.git\n');
            }

            // Run the check-dockerfile.sh script
            let output;
            try {
              output = execSync(`bash "${CHECK_SCRIPT}" "${dockerfilePath}"`, {
                encoding: 'utf-8',
                timeout: 10000,
              });
            } catch (err) {
              // Script exits with non-zero if not all checks pass — that's expected
              output = err.stdout || '';
            }

            // Extract the score from the output (format: "X/5 checks passed")
            const scoreMatch = output.match(/(\d+)\/5 checks passed/);
            expect(scoreMatch).not.toBeNull();

            const actualScore = parseInt(scoreMatch[1], 10);
            const expectedScore = computeExpectedScore(config);

            expect(actualScore).toBe(expectedScore);
          } finally {
            // Cleanup temporary files
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
