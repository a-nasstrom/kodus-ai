export type KodyRuleSeverity = 'low' | 'medium' | 'high' | 'critical';

export type KodyRuleScope = 'pull request' | 'file';

export interface KodyRule {
    uuid: string;
    repositoryId?: string;
    title: string;
    rule: string;
    severity?: KodyRuleSeverity;
    scope?: KodyRuleScope;
    path?: string;
}

export interface CreateKodyRuleRequest {
    title: string;
    rule: string;
    repositoryId?: string;
    severity?: KodyRuleSeverity;
    scope?: KodyRuleScope;
    path?: string;
}

export interface UpdateKodyRuleRequest {
    repositoryId?: string;
    title?: string;
    rule?: string;
    severity?: KodyRuleSeverity;
    scope?: KodyRuleScope;
    path?: string;
}

export interface ViewKodyRulesRequest {
    ruleId?: string;
    repositoryId?: string;
}
