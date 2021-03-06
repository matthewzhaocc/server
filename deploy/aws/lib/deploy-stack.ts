import * as cdk from '@aws-cdk/core';

// import dependencies for ECS and building a VPC
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";

// tls certificate with ACM
import * as route53 from '@aws-cdk/aws-route53';
import * as acm from '@aws-cdk/aws-certificatemanager';
import { FargateTaskDefinition } from '@aws-cdk/aws-ecs';
export class DeployStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, hostedZoneID: string, zoneName: string, domainName: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // create vpc with 3 subnets
    const vpc = new ec2.Vpc(this, "LocalTunnelVPC", {
      maxAzs: 3,
      natGateways: 0
    })
    // create the ecs cluster
    const cluster = new ecs.Cluster(this, "LocalTunnelCluster", {
      vpc: vpc
    })
    // create acm cert
    const DNSZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      zoneName: domainName,
      hostedZoneId: hostedZoneID
    })
    // add wildcard CNAME
    new route53.CnameRecord(this, 'CnameRecordWildcard', {
      zone: DNSZone,
      recordName: "*",
      domainName: domainName
    })
    const cert = new acm.Certificate(this, 'Cert', {
      domainName: domainName,
      subjectAlternativeNames: ["*."+domainName],
      validation: acm.CertificateValidation.fromDns(DNSZone)
    })
    
    
    // task definition
    let FgTask = new FargateTaskDefinition(this, "LocaltunnelDefinition", {
      cpu: 256,
      memoryLimitMiB: 512,
    })
    FgTask.addContainer("localtunnel", {
      image: ecs.ContainerImage.fromRegistry("defunctzombie/localtunnel-server:latest"),
      cpu: 128,
      entryPoint: ["node", "-r", "esm", "./bin/server", "--domain", domainName],
      
    }).addPortMappings({
      containerPort: 80
    })
    
    // create LBed Fargate service
    let localtunnelsvc = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "LocalTunnelService", {
      cluster: cluster,
      cpu: 512,
      desiredCount: 1,
      taskDefinition: FgTask,
      memoryLimitMiB: 2048,
      publicLoadBalancer: true,
      certificate: cert,
      redirectHTTP: true,
      recordType: ecs_patterns.ApplicationLoadBalancedServiceRecordType.ALIAS,
      listenerPort: 443,
      domainName: domainName,
      domainZone: DNSZone,
      assignPublicIp: true
    })
    // set health route
    localtunnelsvc.targetGroup.configureHealthCheck({
      path: "/api/status"
    })
  }
}
