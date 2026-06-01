import { MigrationInterface, QueryRunner } from "typeorm";

export class SpendLimit1780335078312 implements MigrationInterface {
    name = 'SpendLimit1780335078312'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "public"."IDX_org_params_key_org"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."organization_parameters_configkey_enum"
            RENAME TO "organization_parameters_configkey_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."organization_parameters_configkey_enum" AS ENUM(
                'category_workitems_type',
                'timezone_config',
                'review_mode_config',
                'kody_fine_tuning_config',
                'auto_join_config',
                'byok_config',
                'cockpit_metrics_visibility',
                'dry_run_limit',
                'auto_license_assignment',
                'code_review_preset',
                'license_key',
                'license_assigned_users',
                'first_review_at',
                'spend_limit_config'
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_parameters"
            ALTER COLUMN "configKey" TYPE "public"."organization_parameters_configkey_enum" USING "configKey"::"text"::"public"."organization_parameters_configkey_enum"
        `);
        await queryRunner.query(`
            DROP TYPE "public"."organization_parameters_configkey_enum_old"
        `);
        await queryRunner.query(`
            ALTER TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum"
            RENAME TO "workflow_jobs_errorclassification_enum_old"
        `);
        await queryRunner.query(`
            CREATE TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum" AS ENUM(
                'RETRYABLE',
                'NON_RETRYABLE',
                'CIRCUIT_OPEN',
                'PERMANENT',
                'RATE_LIMITED'
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "kodus_workflow"."workflow_jobs"
            ALTER COLUMN "errorClassification" TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum" USING "errorClassification"::"text"::"kodus_workflow"."workflow_jobs_errorclassification_enum"
        `);
        await queryRunner.query(`
            DROP TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum_old"
        `);
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY "IDX_org_params_key_org" ON "organization_parameters" ("configKey", "organization_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX CONCURRENTLY "public"."IDX_org_params_key_org"
        `);
        await queryRunner.query(`
            CREATE TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum_old" AS ENUM(
                'CIRCUIT_OPEN',
                'NON_RETRYABLE',
                'PERMANENT',
                'RETRYABLE'
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "kodus_workflow"."workflow_jobs"
            ALTER COLUMN "errorClassification" TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum_old" USING "errorClassification"::"text"::"kodus_workflow"."workflow_jobs_errorclassification_enum_old"
        `);
        await queryRunner.query(`
            DROP TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "kodus_workflow"."workflow_jobs_errorclassification_enum_old"
            RENAME TO "workflow_jobs_errorclassification_enum"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."organization_parameters_configkey_enum_old" AS ENUM(
                'auto_join_config',
                'auto_license_assignment',
                'byok_config',
                'category_workitems_type',
                'cockpit_metrics_visibility',
                'code_review_preset',
                'dry_run_limit',
                'first_review_at',
                'kody_fine_tuning_config',
                'license_assigned_users',
                'license_key',
                'review_mode_config',
                'timezone_config'
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "organization_parameters"
            ALTER COLUMN "configKey" TYPE "public"."organization_parameters_configkey_enum_old" USING "configKey"::"text"::"public"."organization_parameters_configkey_enum_old"
        `);
        await queryRunner.query(`
            DROP TYPE "public"."organization_parameters_configkey_enum"
        `);
        await queryRunner.query(`
            ALTER TYPE "public"."organization_parameters_configkey_enum_old"
            RENAME TO "organization_parameters_configkey_enum"
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_org_params_key_org" ON "organization_parameters" ("configKey", "organization_id")
        `);
    }

}
