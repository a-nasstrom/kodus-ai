import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CancelPullRequestExecutionBodyDto {
    @ApiProperty({ format: 'uuid' })
    @IsUUID()
    teamId: string;
}

export class CancelPullRequestExecutionResponseDto {
    @ApiProperty({ format: 'uuid' })
    executionUuid: string;

    @ApiProperty()
    status: string;

    @ApiProperty()
    cancelledAt: string;
}
