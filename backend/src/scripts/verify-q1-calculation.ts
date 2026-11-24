/**
 * Requirement Q1 Proof: Core Domain Calculation with Hand-Predicted Expected Result
 * 
 * DOMAIN CALCULATION SPECIFICATION:
 * Course: CSC436 Distributed Systems
 * Model: Weighted Rubric Evaluation for Code Submission
 * Rubric Weights:
 *   - Correctness: 60% (weight = 0.60)
 *   - Testing & Test Coverage: 20% (weight = 0.20)
 *   - Code Style & Concurrency Safety: 20% (weight = 0.20)
 * Total Rubric Weight: 0.60 + 0.20 + 0.20 = 1.00 (100%)
 * 
 * RAW STUDENT SUBMISSION CRITERION SCORES (usr-alan on asg-001):
 *   - Correctness score: 88.0 / 100
 *   - Testing score: 95.0 / 100
 *   - Style score: 78.0 / 100
 * 
 * HAND-PREDICTED EXPECTED RESULT:
 *   Hand Calculation:
 *     Contribution from Correctness: 88.0 * 0.60 = 52.800
 *     Contribution from Testing:     95.0 * 0.20 = 19.000
 *     Contribution from Style:       78.0 * 0.20 = 15.600
 *     Sum of Weighted Components:   52.800 + 19.000 + 15.600 = 87.400
 *   
 *   Expected Final Grade: 87.40
 *   Expected Letter Grade: "B+" (Scale: >=90 A, >=85 B+, >=80 B, >=75 C+)
 */

export interface RubricCriteria {
  criterion: string;
  weight: number;
  rawScore: number;
}

export interface RubricCalculationResult {
  finalScore: number;
  letterGrade: string;
  weightedBreakdown: Array<{
    criterion: string;
    weight: number;
    rawScore: number;
    contribution: number;
  }>;
}

export function computeRubricGrade(criteria: RubricCriteria[]): RubricCalculationResult {
  // Validate total weight sums to 1.00
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.001) {
    throw new Error(`Invalid rubric: weights must sum to 1.00, got ${totalWeight}`);
  }

  let finalScore = 0;
  const weightedBreakdown = criteria.map((c) => {
    if (c.rawScore < 0 || c.rawScore > 100) {
      throw new Error(`Invalid criterion score ${c.rawScore}: must be between 0 and 100`);
    }
    const contribution = Number((c.rawScore * c.weight).toFixed(3));
    finalScore += contribution;
    return {
      criterion: c.criterion,
      weight: c.weight,
      rawScore: c.rawScore,
      contribution,
    };
  });

  finalScore = Number(finalScore.toFixed(2));

  let letterGrade = 'F';
  if (finalScore >= 90) letterGrade = 'A';
  else if (finalScore >= 85) letterGrade = 'B+';
  else if (finalScore >= 80) letterGrade = 'B';
  else if (finalScore >= 75) letterGrade = 'C+';
  else if (finalScore >= 70) letterGrade = 'C';

  return {
    finalScore,
    letterGrade,
    weightedBreakdown,
  };
}

async function runCoreCalculationTest() {
  console.log('================================================================');
  console.log(' Requirement Q1: Core Calculation with Hand-Predicted Result   ');
  console.log('================================================================\n');

  console.log('HAND-PREDICTED EXPECTATION:');
  console.log('  Formula: (88.0 * 0.60) + (95.0 * 0.20) + (78.0 * 0.20)');
  console.log('  Arithmetic: 52.80 + 19.00 + 15.60');
  console.log('  HAND-PREDICTED FINAL SCORE: 87.40');
  console.log('  HAND-PREDICTED LETTER GRADE: B+\n');

  const inputCriteria: RubricCriteria[] = [
    { criterion: 'correctness', weight: 0.60, rawScore: 88.0 },
    { criterion: 'testing', weight: 0.20, rawScore: 95.0 },
    { criterion: 'style', weight: 0.20, rawScore: 78.0 },
  ];

  console.log('EXECUTING CALCULATION FUNCTION...');
  const result = computeRubricGrade(inputCriteria);

  console.log(`  ✓ Computed Final Score: ${result.finalScore}`);
  console.log(`  ✓ Computed Letter Grade: ${result.letterGrade}`);
  console.log('  ✓ Weighted Contribution Breakdown:');
  result.weightedBreakdown.forEach((b) => {
    console.log(`    - ${b.criterion}: ${b.rawScore}/100 × ${b.weight} = ${b.contribution} pts`);
  });

  const HAND_PREDICTED_SCORE = 87.40;
  const HAND_PREDICTED_GRADE = 'B+';

  if (result.finalScore !== HAND_PREDICTED_SCORE) {
    throw new Error(`Calculation mismatch! Hand-predicted: ${HAND_PREDICTED_SCORE}, Computed: ${result.finalScore}`);
  }

  if (result.letterGrade !== HAND_PREDICTED_GRADE) {
    throw new Error(`Grade mismatch! Hand-predicted: ${HAND_PREDICTED_GRADE}, Computed: ${result.letterGrade}`);
  }

  console.log('\n================================================================');
  console.log(' ✓ CALCULATION TEST PASSED: Computed output matches hand prediction! ');
  console.log('================================================================\n');

  process.exit(0);
}

runCoreCalculationTest().catch((err) => {
  console.error('Core calculation test failed:', err);
  process.exit(1);
});

