import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RepositoryModel } from '../infrastructure/adapters/repositories/schemas/repository.model';
import { AstNodeModel } from '../infrastructure/adapters/repositories/schemas/astNode.model';
import { AstEdgeModel } from '../infrastructure/adapters/repositories/schemas/astEdge.model';

import { RepositoryRepository } from '../infrastructure/adapters/repositories/repository.repository';
import { AstGraphRepository } from '../infrastructure/adapters/repositories/astGraph.repository';
import { AstGraphBuildService } from '../infrastructure/adapters/services/astGraphBuild.service';
import { KodusGraphService } from '../infrastructure/adapters/services/kodusGraph.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([RepositoryModel, AstNodeModel, AstEdgeModel]),
    ],
    providers: [
        RepositoryRepository,
        AstGraphRepository,
        AstGraphBuildService,
        KodusGraphService,
    ],
    exports: [
        RepositoryRepository,
        AstGraphRepository,
        AstGraphBuildService,
        KodusGraphService,
    ],
})
export class AstGraphModule {}
